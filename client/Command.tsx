import type { PluginTheme } from "@getpaseo/plugin";
import type { PaseoAgent } from "@getpaseo/client";
import { getPaseoClient, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { PARENT_AGENT_ID_LABEL, type Preferences } from "../shared/settings";
import { adoptAgents } from "../shared/rpc";
import { attentionGroups, permissionSummary, subtree, type AttentionItem, type ProjectGroup } from "../shared/model";
import { transcriptRows } from "../shared/transcript";
import { buildAnswers, parseQuestions, toggleChoice } from "../shared/questions";
import { CoordinatorCard, type CoordinatorActions } from "./Coordinators";
import type { useDirectory } from "./data";
import { AgentTree } from "./AgentTree";
import { Markdown } from "./markdown";
import { Button, Choice, Notice, Section, Status, Wrap } from "./ui";

const CHECK_PRS = "Check the pull requests you watch now. Report each one's status, what it needs and your recommended fix, leading with what needs me. Start fixers only for pull requests that clearly need code work.";
const QUICK = [
  ["Where do things stand?", "Give me bearings: what needs my decision, what is under way, what finished since we last spoke, and what you plan next. Be brief."],
  ["What needs me?", "List only what needs my decision right now, each with your recommendation."],
] as const;

type Pending = PaseoAgent["pendingPermissions"][number];

/** A Coordinator's conversation, live: Paseo's own timeline and agent state, refetched whenever either changes. */
function useConversation(serverId: string, agentId: string) {
  const [items, setItems] = useState<{ type: string }[]>([]);
  const [agent, setAgent] = useState<PaseoAgent | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ref = getPaseoClient(serverId).agents.ref(agentId);
    const load = async () => {
      try {
        const page = await ref.timeline.refetch({ direction: "tail", limit: 300 });
        const snapshot = page.agent ?? (await ref.refresh())?.agent ?? null;
        if (!alive) return;
        setItems(page.entries.map((e) => ((e as { item?: { type: string } }).item ?? e) as { type: string }));
        setAgent(snapshot); setError("");
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    };
    // Bursts of streaming events collapse into one refetch; a slow poll covers anything the stream misses.
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 250); };
    void load();
    const timeline = ref.timeline.subscribe(schedule);
    const unsubscribe = ref.subscribe(schedule);
    const poll = setInterval(() => void load(), 10_000);
    return () => { alive = false; if (timer) clearTimeout(timer); timeline(); unsubscribe(); clearInterval(poll); };
  }, [serverId, agentId, tick]);
  return { items, agent, error, reload: () => setTick((t) => t + 1) };
}

export function Command({ host, theme, layout, values, directory, projects, openAgent, onSummarize, coordinators, selected, onSelect }: {
  host: { id: string; label: string }; theme: PluginTheme; layout: { compact: boolean };
  values: Preferences; directory: ReturnType<typeof useDirectory>; projects: readonly ProjectGroup[];
  openAgent: (agentId: string, serverId: string) => void; onSummarize: (agentId: string, serverId: string) => void;
  coordinators: CoordinatorActions; selected: string; onSelect: (coordinatorId: string) => void;
}) {
  const attention = useMemo(() => {
    const map = new Map<string, AttentionItem>();
    for (const g of attentionGroups(directory.agents, projects)) for (const i of g.items) map.set(`${i.serverId}:${i.agentId}`, i);
    return map;
  }, [directory.agents, projects]);
  const adopt = useRpc(adoptAgents);
  // An archived coordinator is gone from Command; its saved entry is pruned at the next launch.
  const shown = coordinators.hostReadable ? values.coordinators.filter((c) => coordinators.liveAgent(c)) : values.coordinators;
  if (!shown.length) return <Notice theme={theme} text="No coordinators running. Launch one from the Launch tab (Where it runs: Across projects)." />;
  const current = shown.find((c) => c.id === selected) ?? shown[0]!;
  const agent = coordinators.liveAgent(current);
  const team = agent ? subtree(directory.agents, agent.agentId, host.id) : [];
  const ids = new Set(team.map((a) => a.agentId));
  const native = directory.native.filter((n) => n.serverId === host.id && ids.has(n.parentAgentId));
  const direct = new Set(team.filter((a) => agent && a.labels[PARENT_AGENT_ID_LABEL] === agent.agentId).map((a) => a.agentId));
  async function release(agentId: string) {
    if (!agent) return;
    try {
      const { skipped } = await adopt({ coordinatorAgentId: agent.agentId, agentIds: [agentId], action: "release" });
      coordinators.setMessage(skipped.length ? { kind: "error", text: `Not released: ${skipped[0]!.reason}.` } : { kind: "success", text: `Released it from ${current.name}; it is a top-level agent again.` });
    } catch (e) { coordinators.setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
    await directory.refresh();
  }
  const needs = agent ? team.map((a) => attention.get(`${a.serverId}:${a.agentId}`)).filter((i): i is AttentionItem => Boolean(i) && i!.agentId !== agent.agentId) : [];
  return <View style={{ gap: 12 }}>
    <Wrap>{shown.map((c) => <Choice key={c.id} theme={theme} label={`${c.name}${coordinators.liveAgent(c) ? "" : " (not running)"}`} selected={c.id === current.id} onPress={() => onSelect(c.id)} />)}</Wrap>
    {coordinators.message ? <Notice theme={theme} {...coordinators.message} /> : null}
    <CoordinatorCard key={current.id} theme={theme} c={current} actions={coordinators} />
    {agent ? <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 14, alignItems: "flex-start" }}>
      <View style={{ flex: layout.compact ? undefined : 3, width: layout.compact ? "100%" : undefined }}>
        <Chat key={agent.agentId} theme={theme} serverId={host.id} agentId={agent.agentId} title={current.name} compact={layout.compact} openAgent={openAgent}
          quick={current.kind === "pr-manager" ? [["Check PRs", CHECK_PRS], ...QUICK] : QUICK} />
      </View>
      <View style={{ flex: layout.compact ? undefined : 2, width: layout.compact ? "100%" : undefined, gap: 10 }}>
        <Section theme={theme} title="Its agents" subtitle="Everything it started or took over, nested by who started what. Tap one to open it.">
          {needs.length ? <Notice theme={theme} kind="error" text={`${needs.length} of its agents need you: ${needs.map((n) => `${n.title} (${n.headline.toLowerCase()})`).join("; ")}`} /> : null}
          <AgentTree theme={theme} agents={team} native={native} attention={attention} openAgent={openAgent} onSummarize={onSummarize} releasable={direct} onRelease={(id) => void release(id)} empty="It has no agents yet." />
        </Section>
      </View>
    </View> : <Notice theme={theme} text={`${current.name} is not running. Start it above to chat with it.`} />}
  </View>;
}

function Chat({ theme, serverId, agentId, title, compact, openAgent, quick }: {
  theme: PluginTheme; serverId: string; agentId: string; title: string; compact: boolean; openAgent: (agentId: string, serverId: string) => void;
  quick: readonly (readonly [string, string])[];
}) {
  const { items, agent, error, reload } = useConversation(serverId, agentId);
  const rows = useMemo(() => transcriptRows(items as Parameters<typeof transcriptRows>[0]), [items]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const usage = agent?.lastUsage;
  const percent = usage?.contextWindowMaxTokens && usage.contextWindowUsedTokens ? Math.round((100 * usage.contextWindowUsedTokens) / usage.contextWindowMaxTokens) : null;

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setSendError("");
    // Like Enter in Paseo's own composer: steer a running turn rather than interrupt it.
    try { await getPaseoClient(serverId).agents.ref(agentId).send(body, { activeTurnBehavior: "steer" }); setDraft(""); atBottom.current = true; reload(); }
    catch (e) { setSendError(e instanceof Error ? e.message : String(e)); }
    finally { setSending(false); }
  }

  return <View style={{ gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, backgroundColor: theme.colors.surface1, padding: 12 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "700" }}>{title}</Text>
      <Wrap>
        {agent ? <Status theme={theme} status={agent.status} /> : null}
        {percent !== null ? <Text style={{ fontSize: 11, color: percent >= 90 ? theme.colors.statusDanger : percent >= 70 ? theme.colors.statusWarning : theme.colors.foregroundMuted }}>context {percent}%</Text> : null}
        <Button theme={theme} subtle label="Open in Paseo" onPress={() => openAgent(agentId, serverId)} />
      </Wrap>
    </View>
    {error ? <Notice theme={theme} kind="error" text={`Cannot read the conversation: ${error}`} /> : null}
    <ScrollView ref={scroll} style={{ height: compact ? 420 : 560 }} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
      onScroll={(e) => { const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent; atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 60; }}
      scrollEventThrottle={100} onContentSizeChange={() => { if (atBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}>
      {rows.map((row) => {
        if (row.kind === "tool") return <Text key={row.key} numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{row.status === "failed" ? "✗" : row.status === "running" ? "…" : "✓"} {row.text}</Text>;
        if (row.kind === "error") return <Notice key={row.key} theme={theme} kind="error" text={row.text} />;
        if (row.kind === "workbench") return <View key={row.key} style={{ gap: 4 }}>
          <Choice theme={theme} label={`${expanded[row.key] ? "▾" : "▸"} Workbench: ${row.title}`} selected={false} onPress={() => setExpanded({ ...expanded, [row.key]: !expanded[row.key] })} />
          {expanded[row.key] ? <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.text}</Text> : null}
        </View>;
        if (row.kind === "user") return <View key={row.key} style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: theme.colors.surface2, borderRadius: 10, padding: 9 }}>
          <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>{row.text}</Text>
        </View>;
        return <View key={row.key} style={{ maxWidth: "100%" }}><Markdown theme={theme} text={row.text} /></View>;
      })}
      {agent?.status === "running" ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Working…</Text> : null}
    </ScrollView>
    {(agent?.pendingPermissions ?? []).map((request) => <PendingCard key={request.id} theme={theme} serverId={serverId} agentId={agentId} request={request} onDone={reload} openAgent={openAgent} />)}
    <Wrap>{quick.map(([label, text]) => <Choice key={label} theme={theme} label={label} selected={false} onPress={() => void send(text)} />)}</Wrap>
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
      <TextInput value={draft} onChangeText={setDraft} multiline placeholder={`Message ${title}${Platform.OS === "web" ? " (Enter to send, Shift+Enter for a new line)" : ""}`}
        placeholderTextColor={theme.colors.foregroundMuted} accessibilityLabel={`Message ${title}`}
        onKeyPress={(e) => {
          const key = e.nativeEvent as { key: string; shiftKey?: boolean };
          if (Platform.OS === "web" && key.key === "Enter" && !key.shiftKey) { e.preventDefault(); void send(draft); }
        }}
        style={{ flex: 1, color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 9, fontSize: 13, minHeight: 40, maxHeight: 160 }} />
      <Button theme={theme} label={sending ? "Sending…" : "Send"} disabled={sending || !draft.trim()} onPress={() => void send(draft)} />
    </View>
    {sendError ? <Notice theme={theme} kind="error" text={sendError} /> : null}
  </View>;
}

/** Its questions are answered here, as Paseo's own card would; anything else it asks permission for is decided in Paseo. */
function PendingCard({ theme, serverId, agentId, request, onDone, openAgent }: {
  theme: PluginTheme; serverId: string; agentId: string; request: Pending; onDone: () => void; openAgent: (agentId: string, serverId: string) => void;
}) {
  const questions = request.kind === "question" ? parseQuestions(request.input) : null;
  const [chosen, setChosen] = useState<Record<number, number[]>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answers = questions ? buildAnswers(questions, chosen, typed) : null;
  async function respond(allow: boolean) {
    setBusy(true); setError("");
    try {
      await getPaseoClient(serverId).agents.ref(agentId).respondToPermission({ requestId: request.id, response: allow && answers ? { behavior: "allow", updatedInput: { ...(request.input ?? {}), answers } } : { behavior: "deny", message: "Dismissed by user" } });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const box = { gap: 8, borderWidth: 1, borderColor: theme.colors.statusWarning, borderRadius: 10, padding: 10 };
  if (!questions) return <View style={box}>
    <Text style={{ color: theme.colors.statusWarning, fontSize: 12, fontWeight: "600" }}>Waiting for your permission</Text>
    <Text selectable style={{ color: theme.colors.foreground, fontSize: 12 }}>{permissionSummary(request)}</Text>
    <Button theme={theme} subtle label="Decide in Paseo" onPress={() => openAgent(agentId, serverId)} />
  </View>;
  return <View style={box}>
    {questions.map((q, i) => <View key={i} style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{q.question}</Text>
      <Wrap>{q.options.map((o, n) => <Choice key={n} theme={theme} label={o.label} selected={(chosen[i] ?? []).includes(n)} onPress={() => setChosen({ ...chosen, [i]: toggleChoice(chosen[i] ?? [], n, q.multiSelect) })} />)}</Wrap>
      {q.allowOther ? <TextInput value={typed[i] ?? ""} onChangeText={(t) => setTyped({ ...typed, [i]: t })} placeholder="Or type an answer" placeholderTextColor={theme.colors.foregroundMuted}
        style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderRadius: 6, padding: 8, fontSize: 12 }} /> : null}
    </View>)}
    <Wrap>
      <Button theme={theme} label={busy ? "Sending…" : "Answer"} disabled={busy || !answers} onPress={() => void respond(true)} />
      <Button theme={theme} subtle label="Dismiss" disabled={busy} onPress={() => void respond(false)} />
    </Wrap>
    {error ? <Notice theme={theme} kind="error" text={error} /> : null}
  </View>;
}
