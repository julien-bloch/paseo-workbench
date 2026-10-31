import type { getPaseoClient } from "@getpaseo/plugin/client";
import type { AgentSnapshotPayload as PaseoAgent, SessionOutboundMessage, WorkspaceDescriptorPayload as PaseoWorkspace } from "@getpaseo/protocol/messages";
import { permissionSummary, type NativeSubagent, type WorkbenchAgent, type WorkbenchWorkspace } from "../shared/model";

type PaseoApi = ReturnType<typeof getPaseoClient>;

// React-free so integration tests can run it against a real daemon.
async function allWorkspaces(paseo:PaseoApi):Promise<{items:PaseoWorkspace[];truncated:boolean}> {
  const items:PaseoWorkspace[]=[];
  let cursor:string|undefined;
  for(let i=0;i<25;i++){
    const result=await paseo.workspaces.list({page:{limit:200,...(cursor?{cursor}:{})}});
    items.push(...result.entries);
    if(!result.pageInfo.hasMore || !result.pageInfo.nextCursor) return {items,truncated:false};
    cursor=result.pageInfo.nextCursor;
  }
  return {items,truncated:true};
}
async function allAgents(paseo:PaseoApi):Promise<{items:PaseoAgent[];truncated:boolean}> {
  const items:PaseoAgent[]=[];
  let cursor:string|undefined;
  for(let i=0;i<25;i++){
    const result=await paseo.agents.list({page:{limit:200,...(cursor?{cursor}:{})}});
    items.push(...result.entries.map(entry=>entry.agent));
    if(!result.pageInfo.hasMore || !result.pageInfo.nextCursor) return {items,truncated:false};
    cursor=result.pageInfo.nextCursor;
  }
  return {items,truncated:true};
}

export async function directoryForHost(paseo:PaseoApi,serverId:string):Promise<{workspaces:WorkbenchWorkspace[];agents:WorkbenchAgent[];truncated:boolean}> {
  const [w,a]=await Promise.all([allWorkspaces(paseo),allAgents(paseo)]);
  const workspaces=w.items.map(workspace=>({
    serverId,workspaceId:workspace.id,projectId:workspace.projectId,
    projectName:workspace.projectDisplayName||workspace.name||"Unnamed project",
    name:workspace.title||workspace.name||"Workspace", directory:workspace.workspaceDirectory,
    status:workspace.status,
  }));
  const agents=a.items.map(agent=>({
    serverId,agentId:agent.id,workspaceId:agent.workspaceId||"",
    title:agent.title||"Untitled agent",status:agent.status,
    model:agent.model||"",provider:agent.provider,updatedAt:agent.updatedAt,
    labels:agent.labels, requiresAttention:Boolean(agent.requiresAttention),
    pendingPermissionCount:agent.pendingPermissions.length,
    archived:Boolean(agent.archivedAt),
    attentionReason:agent.attentionReason??null,
    attentionSince:agent.attentionTimestamp??null,
    lastError:agent.lastError??null,
    // Summaries only: raw permission inputs can carry whole files or diffs.
    permissions:agent.pendingPermissions.map(permissionSummary),
  }));
  return {workspaces,agents,truncated:w.truncated||a.truncated};
}

type NativeUpdate = Extract<SessionOutboundMessage,{type:"agent.provider_subagents.update"}>["payload"];

/** Apply one provider-native child event to the live-only list. Timeline events do not change the tree. */
export function applyNativeUpdate(list:readonly NativeSubagent[],serverId:string,payload:NativeUpdate):NativeSubagent[] {
  if(payload.kind==="timeline")return [...list];
  const same=(s:NativeSubagent,parentAgentId:string,id:string)=>s.serverId===serverId&&s.parentAgentId===parentAgentId&&s.id===id;
  if(payload.kind==="remove")return list.filter(s=>!same(s,payload.parentAgentId,payload.subagentId));
  const sub=payload.subagent;
  const item:NativeSubagent={
    serverId,id:sub.id,parentAgentId:sub.parentAgentId,
    parentSubagentId:sub.parentSubagentId||null,
    title:sub.title||"Native subagent",description:sub.description||"",
    status:sub.status,updatedAt:sub.updatedAt,
  };
  return [...list.filter(s=>!same(s,item.parentAgentId,item.id)),item];
}

/**
 * Calls `onChange` soon after any agent on this host changes (status, permission request, title...), at most once per
 * `everyMs`. Paseo streams agent updates only while an agent-list subscription is open, so this opens one and
 * releases it on cleanup. Returns the cleanup.
 */
export function watchAgents(paseo:PaseoApi,onChange:()=>void,everyMs=1000):()=>void {
  let alive=true,last=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let subscription:{release:()=>Promise<void>}|undefined;
  const changed=()=>{
    if(!alive||timer)return;
    timer=setTimeout(()=>{timer=undefined;last=Date.now();if(alive)onChange();},Math.max(250,last+everyMs-Date.now()));
  };
  const off=paseo.agents.subscribe(changed);
  paseo.agents.list({subscribe:{},page:{limit:1}})
    .then(r=>{if(alive)subscription=r.subscription;else void r.subscription.release().catch(()=>undefined);})
    .catch(()=>undefined); // live updates are a bonus: the periodic refresh still runs
  return()=>{alive=false;off();if(timer)clearTimeout(timer);void subscription?.release().catch(()=>undefined);};
}
