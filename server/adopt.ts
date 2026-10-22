import type { PaseoApi } from "@getpaseo/client";
import { COORDINATOR_LABEL, PARENT_AGENT_ID_LABEL } from "../shared/settings";
import { cli } from "./cli";
import { readState } from "./state";

/**
 * Adopt: set Paseo's parent label on existing top-level agents so they nest under a Coordinator Workbench registered.
 * Release: detach agents whose parent is that Coordinator. Agents with another parent, and coordinators, are skipped.
 */
export async function adoptOrRelease(paseo: PaseoApi, coordinatorAgentId: string, agentIds: readonly string[], action: "adopt" | "release") {
  if (!(await readState()).coordinators[coordinatorAgentId]) throw new Error("Only a running Workbench coordinator can take over agents.");
  const done: string[] = [], skipped: { agentId: string; reason: string }[] = [];
  for (const agentId of new Set(agentIds)) {
    const agent = (await paseo.agents.ref(agentId).refresh().catch(() => null))?.agent;
    const parent = agent?.labels[PARENT_AGENT_ID_LABEL];
    const reason = !agent ? "not found" : agent.archivedAt ? "archived" : agentId === coordinatorAgentId || agent.labels[COORDINATOR_LABEL] ? "is a coordinator"
      : action === "adopt" ? (parent && parent !== coordinatorAgentId ? "already a subagent of another agent" : "")
      : parent !== coordinatorAgentId ? "not this coordinator's subagent" : "";
    if (reason) { skipped.push({ agentId, reason }); continue; }
    if (action === "adopt" && parent !== coordinatorAgentId) await cli(["agent", "update", `--label=${PARENT_AGENT_ID_LABEL}=${coordinatorAgentId}`, "--", agentId]);
    if (action === "release") await cli(["agent", "detach", "--", agentId]);
    done.push(agentId);
  }
  if (done.length) {
    const list = done.map((id) => `- ${id}`).join("\n");
    await paseo.agents.ref(coordinatorAgentId).send(action === "adopt"
      ? `[Workbench] The user made these existing agents your subagents. Manage them like the agents you start:\n${list}`
      : `[Workbench] The user released these agents; they are no longer yours to manage:\n${list}`, { activeTurnBehavior: "steer" });
  }
  return { done, skipped };
}
