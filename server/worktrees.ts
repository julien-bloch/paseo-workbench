import { execFile } from "node:child_process";
import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import type { WorktreeRow } from "../shared/rpc";

/** The title Workbench gives the worktree it opens for a pull request review (client/actions.ts). */
export const PR_REVIEW_TITLE = /^PR #\d+ review$/;

async function all<T>(page: (cursor?: string) => Promise<{ entries: T[]; pageInfo: { hasMore: boolean; nextCursor?: string | null } }>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 25; i++) {
    const r = await page(cursor);
    items.push(...r.entries);
    if (!r.pageInfo.hasMore || !r.pageInfo.nextCursor) break;
    cursor = r.pageInfo.nextCursor;
  }
  return items;
}
const workspaces = (paseo: PaseoApi) => all<PaseoWorkspace>((cursor) => paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } }));
const agents = async (paseo: PaseoApi) => (await all<{ agent: PaseoAgent }>((cursor) => paseo.agents.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } }))).map((e) => e.agent);

/** Uncommitted or untracked changes. If git cannot tell, assume there are some. */
function dirty(directory: string): Promise<boolean> {
  return new Promise((resolve) => execFile("git", ["-C", directory, "status", "--porcelain"], { timeout: 15_000 }, (error, stdout) => resolve(Boolean(error) || stdout.trim().length > 0)));
}

export async function listWorkbenchWorktrees(paseo: PaseoApi): Promise<{ worktrees: WorktreeRow[] }> {
  const [ws, live] = await Promise.all([workspaces(paseo), agents(paseo)]);
  const trees = ws.filter((w) => w.workspaceKind === "worktree" && w.workspaceDirectory && !w.archivingAt);
  return { worktrees: await Promise.all(trees.map(async (w) => {
    const mine = live.filter((a) => a.workspaceId === w.id && !a.archivedAt);
    return {
      workspaceId: w.id, name: w.title || w.name, project: w.projectDisplayName, directory: w.workspaceDirectory!, status: w.status, activityAt: w.activityAt,
      agents: mine.length, running: mine.filter((a) => a.status === "running" || a.status === "initializing").length,
      dirty: await dirty(w.workspaceDirectory!), prReview: PR_REVIEW_TITLE.test(w.title ?? ""),
    };
  })) };
}

export async function removeWorkbenchWorktree(paseo: PaseoApi, workspaceId: string, mode: "clean-only" | "discard" | "if-unused-pr-review"): Promise<{ removed: boolean; reason?: string }> {
  const w = (await workspaces(paseo)).find((x) => x.id === workspaceId);
  if (!w || w.workspaceKind !== "worktree" || !w.workspaceDirectory) return { removed: false, reason: "not a worktree workspace" };
  const live = (await agents(paseo)).filter((a) => a.workspaceId === w.id && !a.archivedAt);
  if (live.some((a) => a.status === "running" || a.status === "initializing")) return { removed: false, reason: "an agent is working in it" };
  if (mode === "if-unused-pr-review") {
    if (!PR_REVIEW_TITLE.test(w.title ?? "")) return { removed: false, reason: "not a Workbench PR-review worktree" };
    if (live.length) return { removed: false, reason: "other agents still use it" };
  }
  if (mode !== "discard" && await dirty(w.workspaceDirectory)) return { removed: false, reason: "it has uncommitted changes" };
  await paseo.workspaces.archive(w.id);
  return { removed: true };
}
