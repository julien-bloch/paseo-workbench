import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/settings";
import { adoptAgents, createSchedule, folderSpecialists, headerButtonSetting, listWorktrees, removeWorktree, renameCoordinator, ensureCoordinatorHome, listSchedules, registerCoordinator, registerSecondOpinion, scheduleAction, writeCoordinatorContext } from "./shared/rpc";
import { prepareHome, writeBrief } from "./server/context";
import { registerSecondOpinionPair, registerSecondOpinionRelay } from "./server/secondOpinion";
import { adoptOrRelease, renameCoordinatorAgent } from "./server/adopt";
import { readSpecialistsFolder } from "./server/folder";
import { listWorkbenchWorktrees, removeWorkbenchWorktree } from "./server/worktrees";
import { createWorkbenchSchedule, listWorkbenchSchedules, workbenchScheduleAction } from "./server/schedules";
import { registerCoordinatorAgent, registerCoordinatorPermissions } from "./server/coordinatorPermissions";

export default function contribute(server:PluginServerContext) {
  const settings = server.registerSettings(preferences);
  server.handle(ensureCoordinatorHome, async ({coordinatorId}) => prepareHome(coordinatorId));
  server.handle(writeCoordinatorContext, async ({coordinatorId,markdown}) => writeBrief(coordinatorId,markdown));
  server.handle(registerCoordinator, async ({agentId,coordinatorId}, {paseo}) => registerCoordinatorAgent(paseo,settings,agentId,coordinatorId));
  server.handle(registerSecondOpinion, async ({primaryId,secondId,mode,failure}, {paseo}) => registerSecondOpinionPair(paseo,primaryId,secondId,mode,failure));
  server.handle(createSchedule, async (input, {paseo}) => createWorkbenchSchedule(paseo,input));
  server.handle(listSchedules, async () => listWorkbenchSchedules());
  server.handle(scheduleAction, async ({id,action}) => workbenchScheduleAction(id,action));
  server.handle(adoptAgents, async ({coordinatorAgentId,agentIds,action}, {paseo}) => adoptOrRelease(paseo,coordinatorAgentId,agentIds,action));
  server.handle(folderSpecialists, async () => readSpecialistsFolder(settings));
  server.handle(renameCoordinator, async ({agentId,name}) => renameCoordinatorAgent(agentId,name));
  server.handle(listWorktrees, async (_input, {paseo}) => listWorkbenchWorktrees(paseo));
  server.handle(headerButtonSetting, async () => { const read = await settings.read(); return { enabled: read.status === "ready" && read.values.headerButton }; });
  server.handle(removeWorktree, async ({workspaceId,mode}, {paseo}) => removeWorkbenchWorktree(paseo,workspaceId,mode));
  const cleanups = [registerSecondOpinionRelay(server), registerCoordinatorPermissions(server, settings)];
  return () => { for (const cleanup of cleanups) cleanup(); };
}
