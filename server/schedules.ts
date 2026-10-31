import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { escalation } from "../shared/permissions";
import type { ScheduleRow, createSchedule } from "../shared/rpc";
import { cli } from "./cli";
import { readState, updateState } from "./state";

type PaseoApi = PluginHandlerContext["paseo"];

/** Every schedule Workbench creates is named with this prefix; the list shows only those. */
export const PREFIX = "Workbench: ";

type CliRow = { id: string; name: string; cadence: string; target: string; status: string; nextRunAt: string | null };

async function workspaceDirectory(paseo: PaseoApi, workspaceId: string): Promise<string> {
  let cursor: string | undefined;
  for (let i = 0; i < 25; i++) {
    const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    const hit = page.entries.find((w) => w.id === workspaceId);
    if (hit) return hit.workspaceDirectory;
    if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) break;
    cursor = page.pageInfo.nextCursor;
  }
  throw new Error("That workspace is not on this host. Select its host first.");
}

export async function createWorkbenchSchedule(paseo: PaseoApi, input: RpcInput<typeof createSchedule>): Promise<ScheduleRow> {
  const name = `${PREFIX}${input.name}`;
  // "--opt=value" throughout, so no value can be read as another option.
  const cadence = [`--cron=${input.cron}`, `--timezone=${input.timezone}`, `--name=${name}`];
  const { target } = input;
  if (target.kind === "check-in") {
    // Only a Coordinator Workbench created and verified, never an arbitrary agent.
    if (!(await readState()).coordinators[target.agentId]) throw new Error("Only a running Workbench coordinator can get scheduled check-ins.");
    const row = await cli(["heartbeat", "create", ...cadence, "--", input.prompt], target.agentId) as CliRow;
    await updateState((s) => { (s.checkIns ??= {})[row.id] = { agentId: target.agentId, name, cadence: row.cadence }; });
    return { id: row.id, name, cadence: row.cadence, status: row.status, nextRunAt: row.nextRunAt, kind: "check-in", agentId: target.agentId, runs: [] };
  }
  if (target.modeId && escalation({ modeId: target.modeId })) throw new Error(`Workbench does not schedule agents in mode ${target.modeId}.`);
  const cwd = await workspaceDirectory(paseo, target.workspaceId);
  const row = await cli(["schedule", "create", ...cadence, `--provider=${target.providerModel}`, ...(target.modeId ? [`--mode=${target.modeId}`] : []), `--cwd=${cwd}`, "--", input.prompt]) as CliRow;
  return { id: row.id, name, cadence: row.cadence, status: row.status, nextRunAt: row.nextRunAt, kind: "workspace", runs: [] };
}

type CliRun = { id: string; startedAt?: string | null; endedAt?: string | null; status?: string; agentId?: string | null; output?: string | null; error?: string | null };
const RUNS_SHOWN = 10;

/** A schedule's latest runs, newest first, results cut to a readable size. */
async function recentRuns(id: string): Promise<ScheduleRow["runs"]> {
  const runs = ((await cli(["schedule", "inspect", id]) as { runs?: CliRun[] }).runs ?? []).slice(-RUNS_SHOWN).reverse();
  return runs.map((r) => ({ id: r.id, startedAt: r.startedAt ?? null, endedAt: r.endedAt ?? null, status: r.status ?? "unknown", agentId: r.agentId ?? null, output: r.output ? r.output.slice(0, 4000) : null, error: r.error ?? null }));
}

export async function listWorkbenchSchedules(): Promise<{ schedules: ScheduleRow[] }> {
  const rows = (await cli(["schedule", "ls"]) as CliRow[]).filter((r) => r.name.startsWith(PREFIX));
  const checkIns = Object.entries((await readState()).checkIns ?? {});
  const runs = await Promise.all(rows.map((r) => recentRuns(r.id).catch(() => [])));
  return { schedules: [
    ...rows.map((r, i) => ({ id: r.id, name: r.name, cadence: r.cadence, status: r.status, nextRunAt: r.nextRunAt, kind: "workspace" as const, runs: runs[i]! })),
    // The CLI cannot list heartbeats, so these come from what Workbench recorded when it created them.
    ...checkIns.map(([id, c]) => ({ id, name: c.name, cadence: c.cadence, status: "active", nextRunAt: null, kind: "check-in" as const, agentId: c.agentId, runs: [] })),
  ] };
}

export async function workbenchScheduleAction(id: string, action: "pause" | "resume" | "delete"): Promise<{ ok: boolean }> {
  const checkIn = (await readState()).checkIns?.[id];
  if (checkIn) {
    if (action !== "delete") throw new Error("Check-ins can be removed but not paused.");
    // Already gone in Paseo (deleted elsewhere, or its agent was removed): forget it all the same.
    await cli(["heartbeat", "delete", id], checkIn.agentId).catch((error: Error) => { if (!/not found/i.test(error.message)) throw error; });
    await updateState((s) => { delete s.checkIns?.[id]; });
    return { ok: true };
  }
  const row = await cli(["schedule", "inspect", id]) as { name?: string };
  if (!row.name?.startsWith(PREFIX)) throw new Error("Workbench only changes schedules it created.");
  await cli(["schedule", action, id]);
  return { ok: true };
}
