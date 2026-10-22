import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Custom backend work: each Coordinator's fixed home and its durable context file.
const coordinatorId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
export const ensureCoordinatorHome = defineRpc({
  name: "workbench.coordinator_home",
  input: z.object({ coordinatorId }),
  output: z.object({ path: z.string() }),
});

export const writeCoordinatorContext = defineRpc({
  name: "workbench.coordinator_context",
  input: z.object({ coordinatorId, markdown: z.string().min(1).max(120_000) }),
  output: z.object({ path: z.string(), updatedAt: z.string() }),
});

const agentId = z.string().min(1).max(100);
const registration = z.object({ registered: z.boolean(), reason: z.string().optional() });

/** After creating a Coordinator agent: the server verifies it and from then on applies its auto-approvals. */
export const registerCoordinator = defineRpc({
  name: "workbench.register_coordinator",
  input: z.object({ agentId, coordinatorId }),
  output: registration,
});

/** After launching a second opinion or committee: the server verifies the pair and relays reports between them (or `failure`). */
export const registerSecondOpinion = defineRpc({
  name: "workbench.register_second_opinion",
  input: z.object({ primaryId: agentId, secondId: agentId, mode: z.enum(["second-opinion", "committee"]).default("second-opinion"), failure: z.string().max(2000).optional() }),
  output: registration,
});

// Schedules: the Paseo SDK has none, so the plugin server runs the `paseo schedule` / `paseo heartbeat` CLI.
const cron = z.string().trim().regex(/^[0-9*/,-]+( [0-9*/,-]+){4}$/, "five cron fields");
const timezone = z.string().regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/, "IANA time zone").max(64);
export const scheduleRow = z.object({
  id: z.string(), name: z.string(), cadence: z.string(), status: z.string(), nextRunAt: z.string().nullable(),
  /** "workspace": a new agent each run. "check-in": a recurring message to a running Coordinator. */
  kind: z.enum(["workspace", "check-in"]), agentId: z.string().optional(),
});
export type ScheduleRow = z.infer<typeof scheduleRow>;

export const createSchedule = defineRpc({
  name: "workbench.schedule_create",
  input: z.object({
    name: z.string().trim().min(1).max(80), prompt: z.string().min(1).max(60_000), cron, timezone,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("workspace"), workspaceId: z.string().min(1).max(200), providerModel: z.string().regex(/^[a-z0-9-]+\/[^\s]+$/), modeId: z.string().regex(/^([A-Za-z0-9][A-Za-z0-9_.-]*)?$/).max(60).default("") }),
      z.object({ kind: z.literal("check-in"), agentId }),
    ]),
  }),
  output: scheduleRow,
});

export const listSchedules = defineRpc({
  name: "workbench.schedules",
  input: z.object({}),
  output: z.object({ schedules: z.array(scheduleRow) }),
});

/** Check-ins can only be removed: Paseo's heartbeats have no pause. */
export const scheduleAction = defineRpc({
  name: "workbench.schedule_action",
  input: z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{3,63}$/), action: z.enum(["pause", "resume", "delete"]) }),
  output: z.object({ ok: z.boolean() }),
});

/** Make existing agents subagents of a running Coordinator (Paseo's parent label), or release them again. */
export const adoptAgents = defineRpc({
  name: "workbench.adopt_agents",
  input: z.object({ coordinatorAgentId: agentId, agentIds: z.array(agentId).min(1).max(50), action: z.enum(["adopt", "release"]) }),
  output: z.object({ done: z.array(z.string()), skipped: z.array(z.object({ agentId: z.string(), reason: z.string() })) }),
});

/** The Markdown files in the specialists folder set in Settings (read on the plugin's host). */
export const folderSpecialists = defineRpc({
  name: "workbench.folder_specialists",
  input: z.object({}),
  output: z.object({ folder: z.string(), files: z.array(z.object({ file: z.string(), text: z.string() })), error: z.string().optional() }),
});
