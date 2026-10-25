import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { ago, hierarchyRows, isReadyToReview, isWorking, type WorkbenchAgent, type WorkbenchWorkspace } from "../shared/model";
import { COORDINATOR_LABEL, COORDINATOR_VALUE } from "../shared/settings";
import { Notice } from "./ui";

const LIMIT = 30;

/**
 * What is working right now (the header's "working" count), or what finished since you last opened it (Paseo's green
 * dot), newest first; an agent started by another listed one sits under it. Tap one to open it.
 */
export function RunningList({ theme, kind = "running", agents, workspaces, needsYou, hostSuffix, openAgent }: {
  theme: PluginTheme; kind?: "running" | "finished"; agents: readonly WorkbenchAgent[]; workspaces: readonly WorkbenchWorkspace[];
  /** `serverId:agentId` of agents also listed under Needs attention. */
  needsYou: ReadonlySet<string>; hostSuffix: (serverId: string) => string; openAgent: (agentId: string, serverId: string) => void;
}) {
  const now = Date.now();
  const finished = kind === "finished";
  const listed = agents.filter(finished ? isReadyToReview : isWorking);
  if (!listed.length) return <Notice theme={theme} text={finished ? "Nothing new has finished." : "Nothing is running."} />;
  const rows = hierarchyRows(listed, []);
  // Green only for finished, as in Paseo (which draws running as a spinner, not a coloured dot); the theme has accent = green.
  const color = finished ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
  return <View style={{ gap: 6 }}>
    {rows.slice(0, LIMIT).map((row) => {
      const a = listed.find((x) => x.serverId === row.serverId && x.agentId === row.agentId)!;
      const w = workspaces.find((x) => x.serverId === a.serverId && x.workspaceId === a.workspaceId);
      const where = a.labels[COORDINATOR_LABEL] === COORDINATOR_VALUE ? "Coordinator" : w ? `${w.projectName} / ${w.name}` : null;
      const alsoNeedsYou = needsYou.has(`${a.serverId}:${a.agentId}`);
      return <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`Open ${a.title}`} onPress={() => openAgent(a.agentId, a.serverId)}
        style={({ pressed }) => ({ gap: 2, marginLeft: Math.min(row.depth, 4) * 14, paddingLeft: 10, paddingVertical: 6, borderLeftWidth: 2, borderColor: color, borderRadius: 4, backgroundColor: pressed ? theme.colors.surface2 : "transparent" })}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{row.depth ? "↳ " : ""}{a.title}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          <Text style={{ color, fontWeight: "600" }}>{finished ? "Finished" : a.status === "initializing" ? "Starting" : "Working"}</Text>
          {[where ? `${where}${hostSuffix(a.serverId)}` : null, a.model || null, ago((finished && a.attentionSince) || a.updatedAt, now)].filter(Boolean).map((x) => ` · ${x}`).join("")}
          {alsoNeedsYou ? <Text style={{ color: theme.colors.statusWarning }}> · also needs you</Text> : null}
        </Text>
      </Pressable>;
    })}
    {rows.length > LIMIT ? <Notice theme={theme} text={`${rows.length - LIMIT} more not shown (see Overview).`} /> : null}
  </View>;
}
