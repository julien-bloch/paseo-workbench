import { COORDINATOR_LABEL, COORDINATOR_VALUE, PARENT_AGENT_ID_LABEL, SECOND_OPINION_FOR_LABEL, SPECIALIST_LABEL } from "./settings";

/** SDK-independent projection, so the planning/visibility code can be unit-tested offline. */
export type WorkbenchWorkspace = {
  serverId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  name: string;
  directory: string;
  status: string;
};
export type WorkbenchAgent = {
  serverId: string;
  agentId: string;
  workspaceId: string;
  title: string;
  status: string;
  model: string;
  provider: string;
  updatedAt: string;
  labels: Record<string, string>;
  requiresAttention: boolean;
  pendingPermissionCount: number;
  archived: boolean;
  /** Paseo's reason ("permission" | "error" | "finished") and since when; optional for older snapshots. */
  attentionReason?: string | null;
  attentionSince?: string | null;
  lastError?: string | null;
  /** One line per pending permission, from permissionSummary. */
  permissions?: string[];
};
export type NativeSubagent = {
  serverId: string;
  id: string;
  parentAgentId: string;
  parentSubagentId: string | null;
  title: string;
  description: string;
  status: "running" | "completed" | "failed" | "canceled";
  updatedAt: string;
};
export type ProjectGroup = {
  key: string;
  serverId: string;
  projectId: string;
  name: string;
  workspaces: WorkbenchWorkspace[];
  agents: WorkbenchAgent[];
  running: number;
  attention: number;
};
export type AgentRow = {
  kind: "managed" | "native";
  key: string;
  serverId: string;
  agentId: string;
  parentAgentId: string | null;
  depth: number;
  title: string;
  subtitle: string;
  status: string;
  requiresAttention: boolean;
  updatedAt: string;
};

export function projectKey(serverId: string, projectId: string): string {
  return `${serverId}:${projectId}`;
}

/** Needs you: asking for permission or failed (Paseo's amber and red dots, same rules as its deriveAgentStateBucket). */
export function isAttention(agent: WorkbenchAgent): boolean {
  return agent.pendingPermissionCount > 0 || agent.attentionReason === "permission" || agent.status === "error" || agent.attentionReason === "error";
}

/** Paseo's green dot ("ready to review"): finished since you last opened it. Opening the agent in Paseo clears it. */
export function isReadyToReview(agent: WorkbenchAgent): boolean {
  return !agent.archived && agent.requiresAttention && !isAttention(agent) && agent.status !== "running";
}

export function groupProjects(workspaces: readonly WorkbenchWorkspace[], agents: readonly WorkbenchAgent[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const workspace of workspaces) {
    const key = projectKey(workspace.serverId, workspace.projectId);
    let group = map.get(key);
    if (!group) {
      group = { key, serverId: workspace.serverId, projectId: workspace.projectId, name: workspace.projectName || workspace.name, workspaces: [], agents: [], running: 0, attention: 0 };
      map.set(key, group);
    }
    group.workspaces.push(workspace);
  }
  const byWorkspace = new Map(workspaces.map((w) => [`${w.serverId}:${w.workspaceId}`, projectKey(w.serverId,w.projectId)]));
  for (const agent of agents) {
    const key = byWorkspace.get(`${agent.serverId}:${agent.workspaceId}`);
    const group = key && map.get(key);
    if (!group || agent.archived) continue;
    group.agents.push(agent);
    if (agent.status === "running" || agent.status === "initializing") group.running++;
    if (isAttention(agent)) group.attention++;
  }
  return [...map.values()].sort((a, b) => b.attention - a.attention || b.running - a.running || a.name.localeCompare(b.name));
}

function managedKey(host: string, id: string): string { return `managed:${host}:${id}`; }
function nativeKey(host: string, root: string, id: string): string { return `native:${host}:${root}:${id}`; }

/**
 * Merge *real* Paseo-managed relationships with OBSERVED provider-native children.
 * Provider children are read-only and may be missing if observation began late.
 * Orphaned/cyclic relationships fall back to roots rather than breaking the view.
 */
export function hierarchyRows(agents: readonly WorkbenchAgent[], native: readonly NativeSubagent[]): AgentRow[] {
  type Entry = { key: string; parent: string | null; row: AgentRow; time: string };
  const entries = new Map<string, Entry>();
  for (const agent of agents) {
    if (agent.archived) continue;
    const key = managedKey(agent.serverId, agent.agentId);
    const parentId = agent.labels["paseo.parent-agent-id"];
    const parentServer = agent.labels["paseo.parent-server-id"] || agent.serverId;
    entries.set(key, {
      key,
      parent: parentId ? managedKey(parentServer,parentId) : null,
      time: agent.updatedAt,
      row: {kind:"managed",key,serverId:agent.serverId,agentId:agent.agentId,parentAgentId:parentId ?? null,depth:0,title:agent.title || agent.agentId,subtitle:agent.model || agent.provider,status:agent.status,requiresAttention:isAttention(agent),updatedAt:agent.updatedAt},
    });
  }
  for (const child of native) {
    const key = nativeKey(child.serverId,child.parentAgentId,child.id);
    const parent = child.parentSubagentId ? nativeKey(child.serverId,child.parentAgentId,child.parentSubagentId) : managedKey(child.serverId,child.parentAgentId);
    entries.set(key, {
      key,
      parent,
      time:child.updatedAt,
      row: {kind:"native",key,serverId:child.serverId,agentId:child.parentAgentId,parentAgentId:child.parentAgentId,depth:0,title:child.title || "Claude subagent",subtitle:child.description,status:child.status,requiresAttention:child.status === "failed",updatedAt:child.updatedAt},
    });
  }
  const children = new Map<string, Entry[]>();
  const roots: Entry[] = [];
  for (const item of entries.values()) {
    if (!item.parent || item.parent === item.key || !entries.has(item.parent)) { roots.push(item); continue; }
    const siblings = children.get(item.parent) || [];
    siblings.push(item);
    children.set(item.parent,siblings);
  }
  const sort = (a:Entry,b:Entry) => b.time.localeCompare(a.time) || a.key.localeCompare(b.key);
  roots.sort(sort);
  for (const siblings of children.values()) siblings.sort(sort);
  const result: AgentRow[] = [];
  const visited = new Set<string>();
  function visit(e:Entry,depth:number) {
    if (visited.has(e.key)) return;
    visited.add(e.key);
    result.push({...e.row,depth:Math.min(depth,20)});
    for (const child of children.get(e.key)||[]) visit(child,depth+1);
  }
  for (const root of roots) visit(root,0);
  // Handle cycles by treating the remaining members as roots.
  for (const entry of entries.values()) if (!visited.has(entry.key)) visit(entry,0);
  return result;
}

/** Overview headline for attention items. Never reports "all clear" before a read, or while some hosts were not observed. */
export function attentionHeadline(attention: number, unobservedHosts: number, loaded = true): { text: string; clear: boolean } {
  if (!loaded) return { text: "Agent status not read yet.", clear: false };
  const gap = unobservedHosts ? ` ${unobservedHosts} host(s) could not be read, so their status is unknown.` : "";
  if (attention) return { text: `${attention} agent(s) need attention on reachable hosts.${gap}`, clear: false };
  return unobservedHosts ? { text: `No attention items on reachable hosts.${gap}`, clear: false } : { text: "No recorded agent attention items.", clear: true };
}

/**
 * Which current hosts are not fully represented, derived on every render from the live host list
 * (not from the last snapshot), so a newly added, offline, failed or truncated host is never read as clear.
 */
export function hostGaps(hosts: readonly { serverId: string; status: string }[], read: readonly string[], failures: Readonly<Record<string, string>>): Record<string, string> {
  const gaps: Record<string, string> = {};
  for (const host of hosts) {
    if (host.status !== "online") gaps[host.serverId] = `Host ${host.status}; its projects and agents are not shown, so totals are incomplete.`;
    else if (failures[host.serverId]) gaps[host.serverId] = failures[host.serverId]!;
    else if (!read.includes(host.serverId)) gaps[host.serverId] = "Not read yet; its projects and agents are not shown.";
  }
  return gaps;
}


type PermissionLike = { kind?: string; name?: string; title?: string | null; description?: string | null; detail?: unknown };
const clip = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One line saying exactly what a pending permission would do: the command, file, URL, or the request's own wording. */
export function permissionSummary(request: PermissionLike): string {
  const d = (request.detail && typeof request.detail === "object" ? request.detail : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "");
  switch (d.type) {
    case "shell": return clip(`$ ${str("command")}`);
    case "edit": case "write": case "read": return clip(`${d.type} ${str("filePath")}`);
    case "fetch": return clip(`fetch ${str("url")}`);
    case "search": return clip(`search ${str("query")}`);
  }
  if (request.kind === "plan") return "wants to leave plan mode and make changes";
  if (request.kind === "mode") return clip(`wants to change mode${request.title ? `: ${request.title}` : ""}`);
  if (request.kind === "question") return clip(`asks: ${request.title || request.description || request.name || "a question"}`);
  return clip(request.title || request.description || request.name || "a tool call");
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const minutes = Math.max(0, Math.round((now - t) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export type AttentionKind = "permission" | "error";
export type AttentionItem = {
  serverId: string; agentId: string; title: string; workspaceName: string | null;
  /** Title of the agent that started this one (Coordinator, reviewer), when there is one. */
  via: string | null;
  kind: AttentionKind; headline: string; details: string[]; since: string | null;
};
export type AttentionGroup = { key: string; name: string; serverId: string | null; items: AttentionItem[] };
const URGENCY: Record<AttentionKind, number> = { permission: 0, error: 1 };

/**
 * Attention items with their reason and evidence, grouped by project, most urgent first (blocked on you,
 * then failures). Agents outside any listed project (e.g. Coordinators) get their own group.
 */
export function attentionGroups(agents: readonly WorkbenchAgent[], projects: readonly ProjectGroup[]): AttentionGroup[] {
  const groups = new Map<string, AttentionGroup>();
  for (const agent of agents) {
    if (agent.archived || !isAttention(agent)) continue;
    const project = projects.find((p) => p.serverId === agent.serverId && p.workspaces.some((w) => w.workspaceId === agent.workspaceId));
    const workspace = project?.workspaces.find((w) => w.workspaceId === agent.workspaceId);
    const permissions = agent.permissions ?? [];
    const kind: AttentionKind = agent.pendingPermissionCount > 0 || agent.attentionReason === "permission" ? "permission" : "error";
    // Labeled with the agent that started it (committee member, second opinion, a Coordinator's worker).
    const parentId = agent.labels["paseo.parent-agent-id"];
    const parent = parentId ? agents.find((a) => a.serverId === agent.serverId && a.agentId === parentId) : undefined;
    const headline = kind === "permission" ? `Waiting for your permission${agent.pendingPermissionCount > 1 ? ` (${agent.pendingPermissionCount})` : ""}` : "Failed";
    const details = kind === "permission"
      ? [...permissions.slice(0, 3), ...(permissions.length > 3 ? [`and ${permissions.length - 3} more`] : [])]
      : kind === "error" && agent.lastError ? [clip(agent.lastError, 300)] : [];
    const key = project ? project.key : "other";
    const group = groups.get(key) ?? { key, name: project ? project.name : "Not in a project (Coordinators and others)", serverId: project?.serverId ?? null, items: [] };
    // The workspace name only adds information when it differs from the project heading.
    const workspaceName = workspace && workspace.name !== project?.name ? workspace.name : null;
    // Paseo's attention time belongs to its attention reason: a permission asked after an older "finished" gets the
    // agent's last update instead (permission requests carry no time of their own).
    const since = agent.attentionReason === kind ? agent.attentionSince : null;
    group.items.push({ serverId: agent.serverId, agentId: agent.agentId, title: agent.title, workspaceName, via: parentId ? parent?.title ?? parentId : null, kind, headline, details, since: since ?? agent.updatedAt ?? null });
    groups.set(key, group);
  }
  const order = (a: AttentionItem, b: AttentionItem) => URGENCY[a.kind] - URGENCY[b.kind] || (b.since ?? "").localeCompare(a.since ?? "");
  for (const group of groups.values()) group.items.sort(order);
  return [...groups.values()].sort((a, b) => order(a.items[0]!, b.items[0]!));
}


/** An agent and everything started under it (by Paseo's parent label), on one host. */
export function subtree(agents: readonly WorkbenchAgent[], rootId: string, serverId: string): WorkbenchAgent[] {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const a of agents) {
      const parent = a.labels["paseo.parent-agent-id"];
      if (a.serverId === serverId && parent && ids.has(parent) && !ids.has(a.agentId)) { ids.add(a.agentId); grew = true; }
    }
  }
  return agents.filter((a) => a.serverId === serverId && ids.has(a.agentId));
}

/** What a Coordinator coordinates: whole projects, plus single workspaces of other projects. Both empty: every project. */
export type Assignment = { projectIds: string[]; workspaceIds: string[] };
type AssignableProject = { projectId: string; workspaces: readonly { workspaceId: string }[] };

/** A project's state in an assignment: all of it, some of its workspaces, or none. */
export function projectState(a: Assignment, p: AssignableProject): "all" | "some" | "none" {
  if (a.projectIds.includes(p.projectId)) return "all";
  return p.workspaces.some((w) => a.workspaceIds.includes(w.workspaceId)) ? "some" : "none";
}

/** Tap a project: none or some -> all of it; all -> none. */
export function toggleAssignedProject(a: Assignment, p: AssignableProject): Assignment {
  const ids = new Set(p.workspaces.map((w) => w.workspaceId));
  const workspaceIds = a.workspaceIds.filter((id) => !ids.has(id));
  return projectState(a, p) === "all"
    ? { projectIds: a.projectIds.filter((id) => id !== p.projectId), workspaceIds }
    : { projectIds: [...a.projectIds, p.projectId], workspaceIds };
}

/** Tap one workspace of a project: a whole project becomes "all but this one"; selecting its last one makes it whole again. */
export function toggleAssignedWorkspace(a: Assignment, p: AssignableProject, workspaceId: string): Assignment {
  const all = p.workspaces.map((w) => w.workspaceId);
  const current = projectState(a, p) === "all" ? all : all.filter((id) => a.workspaceIds.includes(id));
  const next = current.includes(workspaceId) ? current.filter((id) => id !== workspaceId) : [...current, workspaceId];
  const projectIds = a.projectIds.filter((id) => id !== p.projectId);
  const others = a.workspaceIds.filter((id) => !all.includes(id));
  return next.length === all.length ? { projectIds: [...projectIds, p.projectId], workspaceIds: others } : { projectIds, workspaceIds: [...others, ...next] };
}

const BUSY = new Set(["running", "initializing"]);

/** Working now (the header's "working" count). */
export function isWorking(agent: WorkbenchAgent): boolean {
  return !agent.archived && BUSY.has(agent.status);
}

/** An agent Workbench may offer to archive: not working, not waiting on you, not a coordinator. */
export function archivable(agent: WorkbenchAgent): boolean {
  return !agent.archived && !BUSY.has(agent.status) && agent.pendingPermissionCount === 0 && agent.labels[COORDINATOR_LABEL] !== COORDINATOR_VALUE;
}

/** The agent plus its review team (second opinion / committee members), which go with it. */
export function withTeam(agents: readonly WorkbenchAgent[], serverId: string, agentId: string): string[] {
  return [agentId, ...agents.filter((a) => a.serverId === serverId && !a.archived && a.labels[SECOND_OPINION_FOR_LABEL] === agentId).map((a) => a.agentId)];
}

/** Archiving takes the review team along, so every member must be archivable too (a chair idles while its member still reviews). */
export function teamArchivable(agents: readonly WorkbenchAgent[], agent: WorkbenchAgent): boolean {
  const team = new Set(withTeam(agents, agent.serverId, agent.agentId));
  return archivable(agent) && agents.every((a) => a.serverId !== agent.serverId || !team.has(a.agentId) || archivable(a));
}

/** Finished Workbench specialists (top-level, done, not waiting on you, nor is their team), for "Archive finished specialists". */
export function finishedSpecialists(agents: readonly WorkbenchAgent[]): WorkbenchAgent[] {
  return agents.filter((a) => a.labels[SPECIALIST_LABEL] && !a.labels[PARENT_AGENT_ID_LABEL] && teamArchivable(agents, a));
}

/** The two numbers on the sidebar badge, counted like Workbench's header: what needs you, and what is working. */
export function sidebarCounts(agents: readonly WorkbenchAgent[], projects: readonly ProjectGroup[]): { attention: number; running: number } {
  return {
    attention: attentionGroups(agents, projects).reduce((n, g) => n + g.items.length, 0),
    running: agents.filter(isWorking).length,
  };
}
