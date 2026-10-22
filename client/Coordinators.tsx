import type { PluginTheme } from "@getpaseo/plugin";
import { getPaseoClient, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DEFAULT_COORDINATOR, PR_MANAGER_INSTRUCTIONS, isCoordinatorHome, sameValue, type Coordinator, type Preferences } from "../shared/settings";
import { ensureCoordinatorHome, registerCoordinator, writeCoordinatorContext } from "../shared/rpc";
import { coordinatorBrief } from "../shared/prompts";
import { groupProjects, projectState, toggleAssignedProject, toggleAssignedWorkspace, type Assignment, type ProjectGroup } from "../shared/model";
import { agentToolsEnabled, coordinatorIdOf, createCoordinator, findCoordinator, resolveModel } from "./actions";
import type { useDirectory } from "./data";
import { ModelPicker, useCatalog } from "./catalog";
import { useDraft } from "./useDraft";
import { Button, Choice, Field, Notice, Wrap } from "./ui";

type Message = { kind: "info" | "error" | "success"; text: string };

export type CoordinatorActions = ReturnType<typeof useCoordinators>;

/** Everything a Coordinator needs done: its snapshot, start (idempotent), refresh, registration, and saves. */
export function useCoordinators({ host, values, onSave, directory, hostLabel, openAgent }: {
  host: { id: string; label: string };
  values: Preferences;
  onSave: (next: Preferences) => Promise<boolean>;
  directory: ReturnType<typeof useDirectory>;
  hostLabel: (serverId: string) => string;
  openAgent: (agentId: string, serverId: string) => void;
}) {
  const ensureHome = useRpc(ensureCoordinatorHome);
  const writeContext = useRpc(writeCoordinatorContext);
  const register = useRpc(registerCoordinator);
  // Its autonomy (auto-approved Paseo tools) applies only once the plugin server has verified and recorded it.
  async function registerAgent(c: Coordinator, agentId: string): Promise<string> {
    const result = await register({ agentId, coordinatorId: c.id }).catch((e: unknown) => ({ registered: false, reason: e instanceof Error ? e.message : String(e) }));
    return result.registered ? "" : ` Not registered for autonomy (${result.reason}): its Paseo tool requests will ask you.`;
  }
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [offerNew, setOfferNew] = useState("");
  const [tools, setTools] = useState<boolean | null>(null);
  const hostReadable = !directory.errors[host.id] && directory.updatedAt !== null;
  // A Coordinator acts through Paseo's agent tools, so it can only reach workspaces on its own host.
  const hostWorkspaces = directory.workspaces.filter((w) => w.serverId === host.id && !isCoordinatorHome(w.directory));
  const hostProjects = groupProjects(hostWorkspaces, directory.agents);
  const scoped = (c: Coordinator) => c.projectIds.length > 0 || c.workspaceIds.length > 0;
  const assignedWorkspaces = (c: Coordinator) => scoped(c) ? hostWorkspaces.filter((w) => c.projectIds.includes(w.projectId) || c.workspaceIds.includes(w.workspaceId)) : hostWorkspaces;
  /** What a Coordinator coordinates, as display pills; "not found" when archived or the host is unread. */
  const assignmentPills = (c: Coordinator) => scoped(c) ? [
    ...c.projectIds.map((id) => hostProjects.find((p) => p.projectId === id)?.name ?? `${id} (not found)`),
    ...c.workspaceIds.map((id) => { const w = hostWorkspaces.find((x) => x.workspaceId === id); return w ? `${w.projectName} / ${w.name}` : `${id} (not found)`; }),
  ] : ["Every project on this host"];

  useEffect(() => {
    let alive = true;
    agentToolsEnabled(getPaseoClient(host.id)).then((on) => alive && setTools(on), () => alive && setTools(null));
    return () => { alive = false; };
  }, [host.id]);

  const liveAgent = (c: Coordinator) => directory.agents.find((a) => a.serverId === host.id && !a.archived && coordinatorIdOf(a.labels) === c.id);
  function briefFor(c: Coordinator): string {
    const projects = groupProjects(assignedWorkspaces(c), directory.agents).map((p) => ({
      host: hostLabel(p.serverId), name: p.name,
      workspaces: p.workspaces.map((w) => ({ id: w.workspaceId, name: w.name, directory: w.directory })),
      agents: p.agents.filter((a) => !coordinatorIdOf(a.labels)).slice(0, 60).map((a) => `${a.title} (${a.status}, agent ${a.agentId})`),
      attention: p.attention,
    }));
    const unread = directory.errors[host.id] ? [`${hostLabel(host.id)}: ${directory.errors[host.id]}`] : [];
    return coordinatorBrief(projects, unread, {
      coordinatorName: c.name, scoped: scoped(c), ...(c.kind === "pr-manager" ? { prScope: c.prScope } : {}),
      missing: [...c.projectIds.filter((id) => !hostProjects.some((p) => p.projectId === id)), ...c.workspaceIds.filter((id) => !hostWorkspaces.some((w) => w.workspaceId === id))],
    }).slice(0, 119_000);
  }

  const saveCoordinator = (c: Coordinator) => onSave({ ...values, coordinators: values.coordinators.map((x) => (x.id === c.id ? c : x)) });

  /** Returns the agent id once it runs and the server registered it as a Coordinator, else null. */
  async function start(c: Coordinator, newGeneration = false): Promise<string | null> {
    const model = resolveModel(values.defaultModel, c.model);
    if (!model) { setMessage({ kind: "error", text: "Choose a default model in Settings, or a model for this coordinator, first." }); return null; }
    setBusy(c.id); setMessage(null); setOfferNew("");
    try {
      const home = await ensureHome({ coordinatorId: c.id });
      await writeContext({ coordinatorId: c.id, markdown: briefFor(c) });
      const paseo = getPaseoClient(host.id);
      const input = { paseo, cwd: home.path, model, coordinatorId: c.id, name: c.name, instructions: c.instructions, kind: c.kind };
      let result = newGeneration ? null : await createCoordinator({ ...input, generation: c.generation });
      if (newGeneration || result?.kind === "conflict") {
        // Same key, different settings: a live agent exists, an archived one used older settings, or another device is creating one now.
        // Re-checked on the explicit "Start new" click too; a create still in flight elsewhere at that instant is the remaining gap.
        const live = await findCoordinator(paseo, c.id);
        if (live) { const note = await registerAgent(c, live.agentId); await directory.refresh(); setMessage({ kind: note ? "error" : "info", text: `${c.name} is already running.${note}` }); return note ? null : live.agentId; }
        if (!newGeneration) {
          setOfferNew(c.id);
          setMessage({ kind: "error", text: `${c.name}'s earlier agent used different settings and is no longer active, or another device is starting one right now. Refresh to check, or start a new one.` });
          return null;
        }
      }
      if (!result || result.kind === "conflict" || result.archived) {
        // Reserve the next generation with a compare-and-set, so concurrent devices converge on one agent.
        const generation = c.generation + 1;
        if (!(await saveCoordinator({ ...c, generation }))) throw new Error("Another device changed Workbench settings meanwhile. Wait a moment and try again.");
        result = await createCoordinator({ ...input, generation });
        if (result.kind === "conflict") throw new Error(`Another device started a new ${c.name} with different settings. Refresh to open it.`);
      }
      const note = result.archived ? "" : await registerAgent(c, result.agentId);
      setMessage({ kind: note ? "error" : "success", text: `${c.name} is running.${note}` });
      await directory.refresh();
      return note || result.archived ? null : result.agentId;
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }); void directory.refresh(); return null; }
    finally { setBusy(""); }
  }

  async function refreshContext(c: Coordinator, agentId: string) {
    setBusy(c.id); setMessage(null);
    try {
      const result = await writeContext({ coordinatorId: c.id, markdown: briefFor(c) });
      // Steer, not interrupt, a Coordinator that is mid-turn.
      await getPaseoClient(host.id).agents.ref(agentId).send("I refreshed your Workbench context snapshot in CONTEXT.md. Reread it before continuing.", { activeTurnBehavior: "steer" });
      const note = await registerAgent(c, agentId);
      setMessage({ kind: note ? "error" : "success", text: `Updated ${result.path} and notified ${c.name} once.${note}` });
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(""); }
  }

  /** Save a new coordinator entry and start its agent. `agentId` is null when it was saved but did not start. */
  async function launch(entry: Coordinator): Promise<{ saved: boolean; agentId: string | null }> {
    // Drop entries whose agent is gone (archived), so they never fill the 20-coordinator limit. Only when this host was
    // read, and only entries over 10 minutes old, so one another device is starting right now is kept.
    // shortcut: age read from the "c-<base36 ms>" id; "default" (pre-alpha.7) has none and counts as old.
    const old = (c: Coordinator) => { const t = parseInt(c.id.slice(2), 36); return !c.id.startsWith("c-") || !(t > Date.now() - 600_000); };
    const kept = hostReadable ? values.coordinators.filter((c) => liveAgent(c) || !old(c)) : values.coordinators;
    if (!(await onSave({ ...values, coordinators: [...kept, entry] }))) { setMessage({ kind: "error", text: "Settings changed on another device; try again." }); return { saved: false, agentId: null }; }
    return { saved: true, agentId: await start(entry) };
  }

  return { busy, message, setMessage, offerNew, tools, hostReadable, hostProjects, scoped, assignmentPills, liveAgent, briefFor, saveCoordinator, start, refreshContext, launch, onSave, values, host, openAgent };
}

const pill = (theme: PluginTheme, label: string) => <Text key={label} style={{ color: theme.colors.foreground, fontSize: 12, borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3, maxWidth: "100%" }}>{label}</Text>;
export const prScopeLabels = (prScope: Coordinator["prScope"]) => prScope.includes("all") ? ["All open PRs"] : prScope.length ? prScope.map((s) => (s === "mine" ? "My PRs" : "Asking for my review")) : ["Nothing selected"];

/** One coordinator's status and controls: what it coordinates, start or refresh, project/PR selection, snapshot, edit. */
export function CoordinatorCard({ theme, c, actions }: { theme: PluginTheme; c: Coordinator; actions: CoordinatorActions }) {
  const catalog = useCatalog();
  const [open, setOpen] = useState<"" | "projects" | "prs" | "snapshot" | "edit">("");
  const toggle = (panel: typeof open) => setOpen(open === panel ? "" : panel);
  const { values, onSave, saveCoordinator, setMessage, busy, offerNew, hostReadable, liveAgent, assignmentPills, briefFor, hostProjects, start, refreshContext } = actions;
  const agent = liveAgent(c);
  return <View style={{ gap: 8 }}>
    <Wrap><Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Coordinates:</Text>{assignmentPills(c).map((l) => pill(theme, l))}</Wrap>
    {c.kind === "pr-manager" ? <Wrap><Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Watches:</Text>{prScopeLabels(c.prScope).map((l) => pill(theme, l))}</Wrap> : null}
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Based on {values.helpers.find((h) => h.id === c.profileId)?.name ?? c.profileId} · model {resolveModel(values.defaultModel, c.model) || "not set"}{agent ? "" : hostReadable ? " · not running" : " · status unknown until this host can be read"}</Text>
    <Wrap>
      {agent ? <Button theme={theme} label={busy === c.id ? "Refreshing…" : "Refresh context"} subtle disabled={Boolean(busy)} onPress={() => void refreshContext(c, agent.agentId)} />
        : <Button theme={theme} label={busy === c.id ? "Starting…" : "Start"} disabled={Boolean(busy) || !hostReadable || !resolveModel(values.defaultModel, c.model)} onPress={() => void start(c)} />}
      {!agent && offerNew === c.id ? <Button theme={theme} label="Start a new one" subtle disabled={Boolean(busy)} onPress={() => void start(c, true)} /> : null}
      <Button theme={theme} label="Select coordination projects" subtle onPress={() => toggle("projects")} />
      {c.kind === "pr-manager" ? <Button theme={theme} label="Select PRs to watch" subtle onPress={() => toggle("prs")} /> : null}
      <Button theme={theme} label={open === "snapshot" ? "Hide snapshot" : "Preview snapshot"} subtle onPress={() => toggle("snapshot")} />
      <Button theme={theme} label={open === "edit" ? "Close editor" : "Edit"} subtle onPress={() => toggle("edit")} />
    </Wrap>
    {open === "projects" ? <ProjectSelector theme={theme} stored={c} projects={hostProjects}
      onSave={async (next, base) => {
        if (!sameValue([c.projectIds, c.workspaceIds], base)) { setMessage({ kind: "error", text: `${c.name}'s projects were changed on another device. Your selection is kept; save again to replace them.` }); return false; }
        const ok = await saveCoordinator({ ...c, ...next });
        setMessage(ok ? { kind: "success", text: `${c.name} now coordinates ${assignmentSummary(next)}.${agent ? " Refresh context to tell it." : ""}` } : { kind: "error", text: "Settings changed on another device. Your selection is kept; save again." });
        if (ok) setOpen("");
        return ok;
      }} /> : null}
    {open === "prs" ? <PrScopeSelector theme={theme} stored={c}
      onSave={async (prScope, base) => {
        if (!sameValue(c.prScope, base)) { setMessage({ kind: "error", text: `${c.name}'s watched PRs were changed on another device. Your selection is kept; save again to replace them.` }); return false; }
        const ok = await saveCoordinator({ ...c, prScope });
        setMessage(ok ? { kind: "success", text: `${c.name} now watches ${prScopeLabels(prScope).join(" and ").toLowerCase()}.${agent ? " Refresh context to tell it." : ""}` } : { kind: "error", text: "Settings changed on another device. Your selection is kept; save again." });
        if (ok) setOpen("");
        return ok;
      }} /> : null}
    {open === "snapshot" ? <Text selectable style={{ color: theme.colors.foreground, fontSize: 11, backgroundColor: theme.colors.surface2, padding: 10, borderRadius: 8 }}>{briefFor(c)}</Text> : null}
    {open === "edit" ? <CoordinatorEditor theme={theme} stored={c} catalog={catalog}
      onSave={async (draft, base) => {
        // Only the editor's own fields: a project selection saved meanwhile is neither a conflict nor overwritten.
        const fields = (x: Coordinator) => ({ name: x.name, model: x.model, instructions: x.instructions });
        if (!sameValue(fields(c), fields(base))) { setMessage({ kind: "error", text: `${c.name} was changed on another device since you started editing. Your draft is kept; Discard to load it.` }); return false; }
        const ok = await saveCoordinator({ ...c, ...fields(draft) });
        setMessage(ok ? { kind: "success", text: `${draft.name} saved. Changes apply to its next agent.` } : { kind: "error", text: "Settings changed on another device. Your draft is kept; save again." });
        return ok;
      }}
      onRemove={async () => {
        const ok = await onSave({ ...values, coordinators: values.coordinators.filter((x) => x.id !== c.id) });
        setMessage(ok ? { kind: "info", text: `Removed ${c.name} from Workbench. Its agent, if any, keeps running until you archive it in Paseo.` } : { kind: "error", text: "Settings changed on another device; try again." });
      }} /> : null}
  </View>;
}

type PrScope = Coordinator["prScope"][number];

/** Which pull requests a PR manager watches, chosen by the user and saved on its own. "All open" includes the others. */
export function PrScopeSelector({ theme, stored, onSave }: { theme: PluginTheme; stored: Coordinator; onSave: (prScope: PrScope[], base: PrScope[]) => Promise<boolean> }) {
  const { draft, base, setDraft, discard } = useDraft<PrScope[]>(stored.prScope, `${stored.id}:prs`);
  const [saving, setSaving] = useState(false);
  const toggle = (s: PrScope) => setDraft(s === "all" ? (draft.includes("all") ? [] : ["all"]) : draft.includes(s) ? draft.filter((x) => x !== s) : [...draft.filter((x) => x !== "all"), s]);
  const options: [PrScope, string][] = [["mine", "My PRs"], ["review-requested", "Asking for my review"], ["all", "All open PRs"]];
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>Select PRs to watch</Text>
    <Wrap>{options.map(([id, label]) => <Choice key={id} theme={theme} label={`${draft.includes(id) ? "✓ " : ""}${label}`} selected={draft.includes(id)} onPress={() => toggle(id)} />)}</Wrap>
    <Wrap>
      <Button theme={theme} label={saving ? "Saving…" : "Save selection"} disabled={saving || !draft.length} onPress={() => { setSaving(true); void onSave(draft, base).finally(() => setSaving(false)); }} />
      <Button theme={theme} label="Discard" subtle onPress={discard} />
    </Wrap>
  </View>;
}

/** "3 projects, 2 workspaces", or "every project on this host". */
export const assignmentSummary = (a: Assignment) => !a.projectIds.length && !a.workspaceIds.length ? "every project on this host"
  : [a.projectIds.length ? `${a.projectIds.length} project(s)` : "", a.workspaceIds.length ? `${a.workspaceIds.length} workspace(s)` : ""].filter(Boolean).join(", ");

/**
 * Pick what a Coordinator coordinates: "Every project", or tap projects to take all of each (its workspaces then
 * show below) and tap workspaces to narrow it to those. ✓ is all of a project, ◐ some of its workspaces.
 */
export function AssignmentPicker({ theme, projects, value, onChange }: {
  theme: PluginTheme; projects: readonly ProjectGroup[]; value: Assignment; onChange: (next: Assignment) => void;
}) {
  const every = !value.projectIds.length && !value.workspaceIds.length;
  return <View style={{ gap: 8 }}>
    <Wrap>
      <Choice theme={theme} label={`${every ? "✓ " : ""}Every project on this host`} selected={every} onPress={() => onChange({ projectIds: [], workspaceIds: [] })} />
      {projects.map((p) => {
        const state = projectState(value, p);
        const many = p.workspaces.length > 1;
        return <Choice key={p.projectId} theme={theme} selected={state !== "none"}
          label={`${state === "all" ? "✓ " : state === "some" ? "◐ " : ""}${p.name}${many ? (state === "none" ? " ▸" : " ▾") : ""}`}
          onPress={() => onChange(toggleAssignedProject(value, p))} />;
      })}
    </Wrap>
    {/* A project's workspaces show only while it is selected; "Every project" shows none. */}
    {projects.filter((p) => p.workspaces.length > 1 && projectState(value, p) !== "none").map((p) => {
      const all = projectState(value, p) === "all";
      return <View key={p.projectId} style={{ gap: 6, paddingLeft: 12, borderLeftWidth: 2, borderColor: theme.colors.border }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{p.name}: tap workspaces to coordinate only those</Text>
        <Wrap>{p.workspaces.map((w) => {
          const on = all || value.workspaceIds.includes(w.workspaceId);
          return <Choice key={w.workspaceId} theme={theme} label={`${on ? "✓ " : ""}${w.name}`} selected={on} onPress={() => onChange(toggleAssignedWorkspace(value, p, w.workspaceId))} />;
        })}</Wrap>
      </View>;
    })}
  </View>;
}

/** Which projects or workspaces on this host a Coordinator coordinates, saved on its own. */
export function ProjectSelector({ theme, stored, projects, onSave }: {
  theme: PluginTheme; stored: Coordinator; projects: readonly ProjectGroup[];
  onSave: (next: Assignment, base: [string[], string[]]) => Promise<boolean>;
}) {
  const { draft, base, setDraft, discard } = useDraft<[string[], string[]]>([stored.projectIds, stored.workspaceIds], `${stored.id}:projects`);
  const [saving, setSaving] = useState(false);
  const value = { projectIds: draft[0], workspaceIds: draft[1] };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>Select coordination projects ({assignmentSummary(value)})</Text>
    <AssignmentPicker theme={theme} projects={projects} value={value} onChange={(a) => setDraft([a.projectIds, a.workspaceIds])} />
    <Wrap>
      <Button theme={theme} label={saving ? "Saving…" : "Save selection"} disabled={saving} onPress={() => { setSaving(true); void onSave(value, base).finally(() => setSaving(false)); }} />
      <Button theme={theme} label="Undo changes" subtle onPress={discard} />
    </Wrap>
  </View>;
}

function CoordinatorEditor({ theme, stored, catalog, onSave, onRemove }: {
  theme: PluginTheme; stored: Coordinator; catalog: ReturnType<typeof useCatalog>;
  onSave: (draft: Coordinator, base: Coordinator) => Promise<boolean>; onRemove: () => Promise<void>;
}) {
  const { draft, base, setDraft, changedElsewhere, discard } = useDraft(stored, stored.id);
  const [saving, setSaving] = useState(false);
  return <View style={{ gap: 10 }}>
    <Field theme={theme} label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>Model</Text>
    <ModelPicker theme={theme} catalog={catalog} value={draft.model} onChange={(model) => setDraft({ ...draft, model })} allowEmpty="Use default model" />
    <Field theme={theme} label="Instructions" value={draft.instructions} onChangeText={(instructions) => setDraft({ ...draft, instructions })} multiline helper="Used when its agent starts. A running agent keeps the instructions it started with." />
    {changedElsewhere ? <Notice theme={theme} kind="error" text="Changed on another device since you started editing." /> : null}
    <Wrap>
      <Button theme={theme} label={saving ? "Saving…" : `Save ${draft.name || "coordinator"}`} disabled={saving || !draft.name.trim()} onPress={() => { setSaving(true); void onSave(draft, base).finally(() => setSaving(false)); }} />
      <Button theme={theme} label="Discard" subtle onPress={discard} />
      <Button theme={theme} label="Reset instructions" subtle onPress={() => setDraft({ ...draft, instructions: draft.kind === "pr-manager" ? PR_MANAGER_INSTRUCTIONS : DEFAULT_COORDINATOR.instructions })} />
      <Button theme={theme} label="Remove" subtle onPress={() => void onRemove()} />
    </Wrap>
  </View>;
}
