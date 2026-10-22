import { realpath } from "node:fs/promises";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext, PluginSettings } from "@getpaseo/plugin/server";
import { COORDINATOR_AUTO_APPROVED_TOOLS, COORDINATOR_ID_LABEL, COORDINATOR_LABEL, COORDINATOR_VALUE, PARENT_AGENT_ID_LABEL, type preferences } from "../shared/settings";
import { escalation, isReadOnlyPrCommand, prManagerRequestAllowed } from "../shared/permissions";
import { legacyHomeFor, prepareHome } from "./context";
import { readState, updateState } from "./state";

const PASEO_TOOL = /^mcp__paseo__([a-z_]+)$/;
type Request = { id: string; kind: string; name: string; input?: unknown; detail?: unknown };
type Kind = "general" | "pr-manager";
type Settings = PluginSettings<typeof preferences.schema>;

/** What a registered Coordinator's request is, if it may be auto-approved; otherwise null (the user decides). */
function approvable(request: Request, kind: Kind): string | null {
  if (request.kind !== "tool") return null;
  // A PR manager's own single read-only gh/git command.
  const detail = (request.detail && typeof request.detail === "object" ? request.detail : {}) as Record<string, unknown>;
  const input = (request.input && typeof request.input === "object" ? request.input : {}) as Record<string, unknown>;
  const command = detail.type === "shell" && typeof detail.command === "string" ? detail.command : request.name === "Bash" && typeof input.command === "string" ? input.command : null;
  if (command !== null) return kind === "pr-manager" && isReadOnlyPrCommand(command) ? `read-only command ${command.slice(0, 80)}` : null;
  const tool = PASEO_TOOL.exec(request.name)?.[1];
  if (!tool || !(COORDINATOR_AUTO_APPROVED_TOOLS.includes(tool) || (kind === "pr-manager" && tool === "create_workspace"))) return null;
  const reason = escalation(request.input) ?? (kind === "pr-manager" && !prManagerRequestAllowed(tool, request.input) ? "not a PR worktree or a fixer in an ask-before-shell mode" : null);
  if (reason) { console.log(`left ${tool} for the user (${reason})`); return null; }
  return `Paseo tool ${tool}`;
}

async function kindOf(settings: Settings, coordinatorId: string): Promise<Kind> {
  const state = await settings.read();
  return state.status === "ready" ? state.values.coordinators.find((c) => c.id === coordinatorId)?.kind ?? "general" : "general";
}

async function approve(paseo: PaseoApi, agentId: string, request: Request, kind: Kind) {
  const tool = approvable(request, kind);
  if (!tool) return;
  await paseo.agents.ref(agentId).respondToPermission({ requestId: request.id, response: { behavior: "allow" } });
  console.log(`coordinator ${agentId}: auto-approved ${tool}`);
}

/**
 * Record an agent as a Coordinator only if it really is one Workbench created: the right labels, no parent
 * (agent-created agents get one), and running in that Coordinator's own home. Labels alone are not trusted,
 * because any agent's create_agent can set them.
 */
export async function registerCoordinatorAgent(paseo: PaseoApi, settings: Settings, agentId: string, coordinatorId: string): Promise<{ registered: boolean; reason?: string }> {
  const agent = (await paseo.agents.ref(agentId).refresh())?.agent;
  if (!agent || agent.archivedAt) return { registered: false, reason: "agent not found" };
  if (agent.labels[COORDINATOR_LABEL] !== COORDINATOR_VALUE || (agent.labels[COORDINATOR_ID_LABEL] ?? "default") !== coordinatorId) return { registered: false, reason: "labels do not match" };
  if (agent.labels[PARENT_AGENT_ID_LABEL]) return { registered: false, reason: "created by another agent" };
  // The shared coordinators folder, or the coordinator's own folder from before alpha.15.
  const homes = await Promise.all([(await prepareHome(coordinatorId)).path, legacyHomeFor(coordinatorId)].map((d) => realpath(d).catch(() => "")));
  const cwd = await realpath(agent.cwd).catch(() => "");
  if (!cwd || !homes.includes(cwd)) return { registered: false, reason: "not running in a Coordinator home" };
  await updateState((state) => { state.coordinators[agentId] = coordinatorId; });
  const kind = await kindOf(settings, coordinatorId);
  for (const request of agent.pendingPermissions) await approve(paseo, agentId, request, kind);
  return { registered: true };
}

/** A registered Coordinator's autonomy: its allowed, non-escalating Paseo tool requests are approved; all else goes to the user. */
export function registerCoordinatorPermissions(server: PluginServerContext, settings: Settings): () => void {
  return server.on("agent.permission_requested", async ({ agent, request }, { paseo }) => {
    const coordinatorId = (await readState()).coordinators[agent.id];
    if (!coordinatorId) return;
    await approve(paseo, agent.id, request, await kindOf(settings, coordinatorId));
  });
}
