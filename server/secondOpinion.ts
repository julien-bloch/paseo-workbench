import { createHash } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SPECIALIST_LABEL, PARENT_AGENT_ID_LABEL, SECOND_OPINION_FOR_LABEL } from "../shared/settings";
import { COMMITTEE_MARKER, SECOND_OPINION_MARKER } from "../shared/prompts";
import { readState, updateState } from "./state";

const MAX_REPORT_CHARS = 60_000;
const RETRY_MS = 5_000;
const MAX_RETRIES = 120; // about 10 minutes of a busy or briefly unreachable agent; its next turn end retriggers anyway
// Deliveries for one primary run one at a time, so overlapping hooks cannot send twice.
const queues = new Map<string, Promise<void>>();
const retrying = new Set<string>();
const timers = new Set<ReturnType<typeof setTimeout>>();
let swept = false;

type TimelineItem = { type: string; text?: string };
const items = (page: { entries: unknown[] }) => page.entries.map((e) => ((e as { item?: TimelineItem }).item ?? e) as TimelineItem);
const busy = (status: string | undefined) => status === "running" || status === "initializing";
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);
const timeline = async (paseo: PaseoApi, agentId: string) => items(await paseo.agents.ref(agentId).timeline.refetch({ limit: 1000 }));

/**
 * Record a second opinion only if Workbench launched it: both are Workbench helpers and the second is the primary's
 * child carrying the second-opinion label. Labels alone are not trusted; agents cannot call this RPC.
 */
export async function registerSecondOpinionPair(paseo: PaseoApi, primaryId: string, secondId: string, mode: "second-opinion" | "committee", failure?: string): Promise<{ registered: boolean; reason?: string }> {
  const [primary, second] = await Promise.all([paseo.agents.ref(primaryId).refresh(), paseo.agents.ref(secondId).refresh()]);
  if (!primary?.agent.labels[SPECIALIST_LABEL] || !second?.agent.labels[SPECIALIST_LABEL]) return { registered: false, reason: "not Workbench helpers" };
  if (second.agent.labels[SECOND_OPINION_FOR_LABEL] !== primaryId || second.agent.labels[PARENT_AGENT_ID_LABEL] !== primaryId) return { registered: false, reason: "labels do not link the pair" };
  await updateState((state) => { state.secondOpinions[secondId] = { primaryId, delivered: [], ...(mode === "committee" ? { mode, stage: 0 } : {}), ...(failure ? { failure } : {}) }; });
  sweepOnce(paseo);
  schedule(paseo, primaryId);
  return { registered: true };
}

/** Pairs whose step became due while the plugin was stopped: scheduled on the first event or RPC after start. */
export function sweepOnce(paseo: PaseoApi) {
  if (swept) return;
  swept = true;
  void readState().then((state) => { for (const primaryId of new Set(Object.values(state.secondOpinions).map((p) => p.primaryId))) schedule(paseo, primaryId); });
}

export function registerSecondOpinionRelay(server: PluginServerContext): () => void {
  const offs = [
    server.on("agent.turn_ended", async ({ agent }, { paseo }) => {
      sweepOnce(paseo);
      const state = await readState();
      const primaryId = state.secondOpinions[agent.id]?.primaryId ?? (Object.values(state.secondOpinions).some((p) => p.primaryId === agent.id) ? agent.id : null);
      if (primaryId) schedule(paseo, primaryId);
    }),
    // The plugin server can reach Paseo only from an event or RPC, so any of these starts the post-restart sweep.
    server.on("agent.turn_started", (_event, { paseo }) => sweepOnce(paseo)),
    server.on("agent.created", (_event, { paseo }) => sweepOnce(paseo)),
    server.on("agent.permission_requested", (_event, { paseo }) => sweepOnce(paseo)),
  ];
  return () => { for (const off of offs) off(); for (const timer of timers) clearTimeout(timer); timers.clear(); };
}

function schedule(paseo: PaseoApi, primaryId: string, attempt = 0) {
  const run = (queues.get(primaryId) ?? Promise.resolve())
    .then(() => deliver(paseo, primaryId))
    .catch((error) => { console.error("second-opinion relay failed", error instanceof Error ? error.message : error); return "retry" as const; })
    .then((outcome) => {
      if (outcome !== "retry" || attempt >= MAX_RETRIES || retrying.has(primaryId)) return;
      retrying.add(primaryId);
      const timer = setTimeout(() => { timers.delete(timer); retrying.delete(primaryId); schedule(paseo, primaryId, attempt + 1); }, RETRY_MS);
      timers.add(timer);
    });
  queues.set(primaryId, run);
}

/**
 * Send a relay message exactly once. Paseo does not de-duplicate sends, so each message carries a stable relay id and
 * is skipped when the target's timeline already has it (a send whose acknowledgement was lost, or a crash before the
 * step was recorded). Steer, never interrupt: if a turn started since the idle check, the message joins it.
 */
async function relaySend(paseo: PaseoApi, targetId: string, relayId: string, text: string) {
  const tag = `[relay ${relayId}]`;
  const already = (await timeline(paseo, targetId)).some((i) => i.type === "user_message" && (i.text ?? "").includes(tag));
  if (!already) await paseo.agents.ref(targetId).send(`${text}\n\n${tag}`, { activeTurnBehavior: "steer" });
}

/** The agent's reply to the relay message carrying `relayId`: assistant text after it, up to the next user message. */
function replyAfter(list: readonly TimelineItem[], relayId: string): string {
  const at = list.findIndex((i) => i.type === "user_message" && (i.text ?? "").includes(`[relay ${relayId}]`));
  if (at < 0) return "";
  const out: string[] = [];
  for (const i of list.slice(at + 1)) { if (i.type === "user_message") break; if (i.type === "assistant_message") out.push(i.text ?? ""); }
  return out.join("\n").trim().slice(0, MAX_REPORT_CHARS);
}

/** What an agent said after its latest user message (its latest report), or "" if it has not answered yet. */
function lastReport(list: readonly TimelineItem[]): string {
  const lastTask = list.map((i) => i.type).lastIndexOf("user_message");
  return list.slice(lastTask + 1).filter((i) => i.type === "assistant_message").map((i) => i.text ?? "").join("\n").trim().slice(0, MAX_REPORT_CHARS);
}

/**
 * One committee step, only while both members are idle: exchange the independent reviews, then, once both have
 * answered the exchange, ask the chair for the consensus. Reviews are frozen when the exchange starts.
 */
async function committeeStep(paseo: PaseoApi, chairId: string, memberId: string, chairStatus: string): Promise<"done" | "retry"> {
  const pair = (await readState()).secondOpinions[memberId];
  if (!pair || (pair.stage ?? 0) >= 2) return "done";
  const member = (await paseo.agents.ref(memberId).refresh())?.agent;
  if (!member || member.archivedAt) return "done";
  if (busy(chairStatus) || busy(member.status)) return "retry";
  const [chairList, memberList] = await Promise.all([timeline(paseo, chairId), timeline(paseo, memberId)]);
  const toMember = `c0m:${memberId}`, toChair = `c0c:${memberId}`, consensus = `c1:${memberId}`;
  if ((pair.stage ?? 0) === 0) {
    let exchange = pair.exchange;
    if (!exchange) {
      const chairReport = lastReport(chairList), memberReport = lastReport(memberList);
      if (!chairReport || !memberReport) return "done"; // a turn end of the other member triggers this again
      exchange = { toMember: chairReport, toChair: memberReport };
      const frozen = exchange;
      await updateState((s) => { const p = s.secondOpinions[memberId]; if (p) p.exchange = frozen; });
    }
    await relaySend(paseo, memberId, toMember, `${COMMITTEE_MARKER} The chair's review (agent ${chairId}):\n\n${exchange.toMember}\n\nCheck each of its findings against the code. For each, say whether you agree or disagree, with evidence, then list what you still disagree on.`);
    await relaySend(paseo, chairId, toChair, `${COMMITTEE_MARKER} The member's review (agent ${memberId}):\n\n${exchange.toChair}\n\nCheck each of its findings against the code and say for each whether you agree or disagree, with evidence. The member's response to your findings follows later.`);
    await updateState((s) => { const p = s.secondOpinions[memberId]; if (p) p.stage = 1; });
    return "done";
  }
  // Stage 1: both have replied to the exchanged review (even if a reply repeats their earlier text).
  const memberReply = replyAfter(memberList, toMember);
  if (!memberReply || !replyAfter(chairList, toChair)) return "done";
  await relaySend(paseo, chairId, consensus, `${COMMITTEE_MARKER} The member's response to your findings (agent ${memberId}):\n\n${memberReply}\n\nNow write the committee's consensus as described in your task: the table, then where the members diverged and how each divergence was resolved or why it remains open.`);
  await updateState((s) => { const p = s.secondOpinions[memberId]; if (p) { p.stage = 2; delete p.exchange; } });
  return "done";
}

/** Send at most one pending report to an idle primary. "retry" when an agent is busy or a send failed. */
async function deliver(paseo: PaseoApi, primaryId: string): Promise<"done" | "retry"> {
  const pairs = Object.entries((await readState()).secondOpinions).filter(([, pair]) => pair.primaryId === primaryId);
  if (!pairs.length) return "done";
  const primary = (await paseo.agents.ref(primaryId).refresh())?.agent;
  if (!primary || primary.archivedAt) return "done";
  let waiting = false;
  for (const [secondId, pair] of pairs) {
    if (pair.mode === "committee" && !pair.failure) {
      if ((await committeeStep(paseo, primaryId, secondId, primary.status)) === "retry") waiting = true;
      continue;
    }
    let report: string;
    if (pair.failure) report = `The ${pair.mode === "committee" ? "committee member" : "second opinion"} could not start: ${pair.failure}`;
    else {
      const second = (await paseo.agents.ref(secondId).refresh())?.agent;
      if (!second) continue;
      if (busy(second.status)) { waiting = true; continue; } // status can lag its turn-end event: check again shortly
      const text = lastReport(await timeline(paseo, secondId));
      if (!text && !second.lastError) continue; // created but not finished yet
      report = text || `The second opinion failed: ${second.lastError}`;
    }
    const key = hash(report);
    if (pair.delivered.includes(key)) continue;
    if (busy(primary.status)) return "retry";
    await relaySend(paseo, primaryId, `so:${secondId}:${key}`, `${SECOND_OPINION_MARKER} from agent ${secondId}:\n\n${report}\n\nCheck each of these findings against the code yourself, then finish with the table described in your task.`);
    await updateState((s) => { s.secondOpinions[secondId]?.delivered.push(key); });
    return "done"; // sending starts a new primary turn; any further report goes when it ends
  }
  return waiting ? "retry" : "done";
}
