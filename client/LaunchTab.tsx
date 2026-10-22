import type { PluginTheme } from "@getpaseo/plugin";
import { getPaseoClient, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { COORDINATOR_LABEL, DEFAULT_COORDINATOR, PARENT_AGENT_ID_LABEL, coordinatorInstructionsFor, ownCoordinatorInstructions, type Coordinator, type Preferences } from "../shared/settings";
import type { Assignment, ProjectGroup } from "../shared/model";
import { adoptAgents, createSchedule } from "../shared/rpc";
import { resolveModel } from "./actions";
import { ModelPicker, useCatalog } from "./catalog";
import { AssignmentPicker, assignmentSummary, type CoordinatorActions } from "./Coordinators";
import { SpecialistLaunch } from "./SpecialistLaunch";
import { Schedules } from "./Schedules";
import { Button, Choice, Field, Notice, Section, Wrap } from "./ui";

const CADENCES = [["Every hour", "0 * * * *"], ["Weekdays at 9:00", "0 9 * * 1-5"], ["Every day at 9:00", "0 9 * * *"], ["Mondays at 9:00", "0 9 * * 1"], ["Custom", ""]] as const;
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const CHECK_IN = "[Workbench check-in] Review the agents in your projects: follow up on finished or stuck work, start what is needed next, and report briefly what changed and what needs me.";
const PR_CHECK_IN = "[Workbench check-in] Check the pull requests you watch, as described in your instructions, and report what changed and what needs me.";

/**
 * One launch form: what to launch, where it runs (in one workspace, or across projects as a coordinator that
 * manages agents), when (one time, or on a Paseo schedule), then its details and a single launch button.
 */
export function LaunchTab({ theme, values, projects, hostLabel, multiHost, coordinators, openAgent, onCoordinatorLaunched }: {
  theme: PluginTheme; values: Preferences; projects: readonly ProjectGroup[]; hostLabel: (serverId: string) => string; multiHost: boolean;
  coordinators: CoordinatorActions; openAgent: (agentId: string, serverId: string) => void; onCoordinatorLaunched: (coordinatorId: string) => void;
}) {
  const catalog = useCatalog();
  const [profileId, setProfileId] = useState(values.helpers[0]?.id ?? "");
  const profile = values.helpers.find((h) => h.id === profileId) ?? values.helpers[0];
  const [where, setWhere] = useState<"workspace" | "projects">("workspace");
  const scope = profile?.coordinatorOnly ? "projects" : where;
  const [when, setWhen] = useState<"now" | "scheduled">("now");
  const [cadence, setCadence] = useState<string>(CADENCES[1][1]);
  const [customCron, setCustomCron] = useState("");
  const cron = (cadence || customCron).trim();
  const cadenceLabel = CADENCES.find(([, c]) => c === cadence)?.[0] ?? "Custom";
  const schedule = when === "scheduled" ? { cron, timezone: TIMEZONE, label: cadence ? cadenceLabel : `on "${cron}"` } : null;
  const [schedulesVersion, setSchedulesVersion] = useState(0);
  // In a workspace
  const [projectKey, setProjectKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const project = projects.find((p) => p.key === projectKey) ?? projects[0];
  // Pin the default target, so a re-sorted directory poll never moves where you are about to launch.
  useEffect(() => { if (!projectKey && projects[0]) setProjectKey(projects[0].key); }, [projectKey, projects]);
  const workspace = project?.workspaces.find((w) => w.workspaceId === workspaceId) ?? project?.workspaces[0];
  // Across projects
  const [assignment, setAssignment] = useState<Assignment>({ projectIds: [], workspaceIds: [] });
  const { projectIds, workspaceIds } = assignment;
  const [prScope, setPrScope] = useState<Coordinator["prScope"]>(["mine"]);
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
  const isPrManager = profile?.id === "pr-manager";
  const [checkIn, setCheckIn] = useState("");
  const checkInPrompt = checkIn.trim() ? `[Workbench check-in] ${checkIn.trim()}` : isPrManager ? PR_CHECK_IN : CHECK_IN;
  const [launching, setLaunching] = useState(false);
  const [launchNote, setLaunchNote] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const scheduleCreate = useRpc(createSchedule);
  const adopt = useRpc(adoptAgents);
  const [adoptIds, setAdoptIds] = useState<string[]>([]);
  // Existing top-level agents in the projects it will coordinate, newest first.
  const every = !projectIds.length && !workspaceIds.length;
  const candidates = projects.filter((p) => p.serverId === coordinators.host.id)
    .flatMap((p) => p.agents.filter((a) => every || projectIds.includes(p.projectId) || workspaceIds.includes(a.workspaceId))).filter((a) => !a.archived && a.status !== "closed" && !a.labels[PARENT_AGENT_ID_LABEL] && !a.labels[COORDINATOR_LABEL])
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const adopting = adoptIds.filter((id) => candidates.some((a) => a.agentId === id));
  const coordinatorModel = resolveModel(values.defaultModel, model || profile?.model || "");
  const running = values.coordinators.filter((c) => coordinators.liveAgent(c));

  async function launchCoordinator() {
    if (!profile) return;
    setLaunching(true); setLaunchNote(null);
    const entry: Coordinator = {
      ...DEFAULT_COORDINATOR, id: `c-${Date.now().toString(36)}`,
      name: name.trim() || (ownCoordinatorInstructions(profile) ? profile.name : `${profile.name} coordinator`),
      instructions: coordinatorInstructionsFor(profile), model: model || profile.model,
      projectIds, workspaceIds, profileId: profile.id, kind: isPrManager ? "pr-manager" : "general", prScope,
    };
    try {
      const { saved, agentId } = await coordinators.launch(entry);
      if (!saved) return;
      if (!agentId) { if (schedule || adopting.length) setLaunchNote({ kind: "error", text: `${entry.name} did not start, so it took over no agents and no check-ins were scheduled.` }); return; }
      const problems: string[] = [];
      if (adopting.length) {
        try {
          const result = await adopt({ coordinatorAgentId: agentId, agentIds: adopting, action: "adopt" });
          if (result.skipped.length) problems.push(`${result.skipped.length} agent(s) not taken over: ${result.skipped.map((x) => x.reason).join("; ")}`);
          setAdoptIds([]);
        } catch (e) { problems.push(`it did not take over the agents you picked: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (schedule) {
        try {
          await scheduleCreate({ name: `${entry.name} check-in`, prompt: checkInPrompt, cron: schedule.cron, timezone: schedule.timezone, target: { kind: "check-in", agentId } });
          setSchedulesVersion((v) => v + 1);
        } catch (e) { problems.push(`its check-ins were not scheduled: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (problems.length) { setLaunchNote({ kind: "error", text: `${entry.name} is running, but ${problems.join("; ")}.` }); return; }
      onCoordinatorLaunched(entry.id);
    } finally { setLaunching(false); }
  }

  const togglePr = (s: Coordinator["prScope"][number]) => setPrScope(s === "all" ? (prScope.includes("all") ? [] : ["all"]) : prScope.includes(s) ? prScope.filter((x) => x !== s) : [...prScope.filter((x) => x !== "all"), s]);
  const label = (text: string) => <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{text}</Text>;
  const note = (text: string) => <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{text}</Text>;

  return <View style={{ gap: 16 }}>
    <Section theme={theme} title="Launch">
      {label("What")}
      <Wrap>{values.helpers.map((h) => <Choice key={h.id} theme={theme} label={h.name} selected={h.id === profile?.id} onPress={() => setProfileId(h.id)} />)}</Wrap>
      {profile ? note(profile.description) : <Notice theme={theme} text="No specialists. Add one in Settings." />}

      {label("Where it runs")}
      <Wrap>
        {profile?.coordinatorOnly ? null : <Choice theme={theme} label="In a workspace" selected={scope === "workspace"} onPress={() => setWhere("workspace")} />}
        <Choice theme={theme} label="Across projects" selected={scope === "projects"} onPress={() => setWhere("projects")} />
      </Wrap>
      {note(scope === "workspace"
        ? "Works on one task in one workspace, then stops."
        : `Runs as a coordinator${!profile || ownCoordinatorInstructions(profile) ? "" : ` with ${profile.name}'s expertise`}: keeps running, watches the projects you choose, and starts and manages agents there. Chat with it in Command.`)}

      {label("When")}
      <Wrap>
        <Choice theme={theme} label="One time" selected={when === "now"} onPress={() => setWhen("now")} />
        <Choice theme={theme} label="Scheduled" selected={when === "scheduled"} onPress={() => setWhen("scheduled")} />
      </Wrap>
      {when === "scheduled" ? <>
        <Wrap>{CADENCES.map(([text, c]) => <Choice key={text} theme={theme} label={text} selected={cadence === c} onPress={() => setCadence(c)} />)}</Wrap>
        {!cadence ? <Field theme={theme} label="Cron (minute hour day month weekday)" value={customCron} onChangeText={setCustomCron} placeholder="30 8 * * 1-5" /> : null}
        {note(scope === "workspace"
          ? `A Paseo schedule (${TIMEZONE}) starts a new agent in the workspace at each run.`
          : `Launches the coordinator now, then Paseo sends it a check-in message on this schedule (${TIMEZONE}).`)}
      </> : null}

      {scope === "workspace" && profile ? <>
        {label("Workspace")}
        <Wrap>{projects.map((p) => <Choice key={p.key} theme={theme} label={multiHost ? `${p.name} (${hostLabel(p.serverId)})` : p.name} selected={project?.key === p.key} onPress={() => { setProjectKey(p.key); setWorkspaceId(""); }} />)}</Wrap>
        {project && project.workspaces.length > 1 ? <Wrap>{project.workspaces.map((w) => <Choice key={w.workspaceId} theme={theme} label={w.name} selected={workspace?.workspaceId === w.workspaceId} onPress={() => setWorkspaceId(w.workspaceId)} />)}</Wrap> : null}
        {!projects.length ? <Notice theme={theme} text="No projects on reachable hosts. Add one in Paseo." /> : null}
        {project && workspace ? <SpecialistLaunch key={profile.id} embedded theme={theme} specialistId={profile.id} paseo={getPaseoClient(workspace.serverId)} settings={values} project={project} workspace={workspace}
          schedule={schedule} onScheduled={() => setSchedulesVersion((v) => v + 1)} onCreated={(id) => openAgent(id, workspace.serverId)} /> : null}
      </> : null}

      {scope === "projects" && profile ? <>
        <Notice theme={theme} kind="error" text="Coordinators act on their own: they may start, message and stop agents in their projects, which spends tokens without asking you. They never commit, push, merge, deploy, or approve another agent's permission request without you." />
        {coordinators.tools === false ? <Notice theme={theme} kind="error" text="Agent tools are off on this host (daemon setting mcp.injectIntoAgents), so coordinators can plan but cannot start or message agents. Workbench does not change this setting." /> : null}
        <Field theme={theme} label="Name" value={name} onChangeText={setName} placeholder={ownCoordinatorInstructions(profile) ? profile.name : `${profile.name} coordinator`} />
        {label(`Projects it coordinates (${assignmentSummary(assignment)})`)}
        <AssignmentPicker theme={theme} projects={coordinators.hostProjects} value={assignment} onChange={setAssignment} />
        {label(`Existing agents it takes over (${adopting.length ? `${adopting.length} selected` : "optional"})`)}
        {candidates.length ? <Wrap>{candidates.slice(0, 30).map((a) => <Choice key={a.agentId} theme={theme} label={`${adopting.includes(a.agentId) ? "✓ " : ""}${a.title}`} selected={adopting.includes(a.agentId)}
          onPress={() => setAdoptIds(adopting.includes(a.agentId) ? adopting.filter((x) => x !== a.agentId) : [...adopting, a.agentId])} />)}</Wrap>
          : note("No top-level agents in these projects.")}
        {candidates.length ? note(`They become its subagents: nested under it in Paseo and in Command, where you can release them.${candidates.length > 30 ? " Showing the 30 most recent." : ""}`) : null}
        {isPrManager ? <>
          {label("PRs to watch")}
          <Wrap>{([["mine", "My PRs"], ["review-requested", "Asking for my review"], ["all", "All open PRs"]] as const).map(([id, text]) => <Choice key={id} theme={theme} label={`${prScope.includes(id) ? "✓ " : ""}${text}`} selected={prScope.includes(id)} onPress={() => togglePr(id)} />)}</Wrap>
        </> : null}
        {label("Model")}
        <ModelPicker theme={theme} catalog={catalog} value={model} onChange={setModel} allowEmpty={`Default (${resolveModel(values.defaultModel, profile.model) || "not set"})`} />
        {schedule ? <Field theme={theme} label="At each check-in" value={checkIn} multiline onChangeText={setCheckIn} placeholder={(isPrManager ? PR_CHECK_IN : CHECK_IN).replace("[Workbench check-in] ", "")} /> : null}
        {coordinators.message ? <Notice theme={theme} {...coordinators.message} /> : null}
        {launchNote ? <Notice theme={theme} {...launchNote} /> : null}
        <Button theme={theme} label={launching ? "Launching…" : schedule ? "Launch and schedule check-ins" : "Launch coordinator"}
          disabled={launching || !coordinatorModel || !coordinators.hostReadable || (isPrManager && !prScope.length) || running.length >= 20 || (!!schedule && !cron)} onPress={() => void launchCoordinator()} />
        {running.length ? note(`Running: ${running.map((c) => c.name).join(", ")}. Manage them in Command.`) : null}
      </> : null}
    </Section>
    <Schedules theme={theme} version={schedulesVersion} />
  </View>;
}
