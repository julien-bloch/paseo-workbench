import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { ago, type WorkbenchAgent, type WorkbenchWorkspace } from "../shared/model";
import { COORDINATOR_LABEL, COORDINATOR_VALUE } from "../shared/settings";
import { Notice } from "./ui";

/** What is working right now (the header's "working" count), newest activity first. Tap one to open it. */
export function RunningList({ theme, agents, workspaces, needsYou, hostSuffix, openAgent }: {
  theme: PluginTheme; agents: readonly WorkbenchAgent[]; workspaces: readonly WorkbenchWorkspace[];
  /** `serverId:agentId` of agents also listed under Needs attention. */
  needsYou: ReadonlySet<string>; hostSuffix: (serverId: string) => string; openAgent: (agentId: string, serverId: string) => void;
}) {
  const now = Date.now();
  const running = agents.filter((a) => !a.archived && (a.status === "running" || a.status === "initializing")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!running.length) return <Notice theme={theme} text="Nothing is running." />;
  return <View style={{ gap: 6 }}>
    {running.map((a) => {
      const w = workspaces.find((x) => x.serverId === a.serverId && x.workspaceId === a.workspaceId);
      const where = a.labels[COORDINATOR_LABEL] === COORDINATOR_VALUE ? "Coordinator" : w ? `${w.projectName} / ${w.name}` : null;
      const alsoNeedsYou = needsYou.has(`${a.serverId}:${a.agentId}`);
      return <Pressable key={`${a.serverId}:${a.agentId}`} accessibilityRole="button" accessibilityLabel={`Open ${a.title}`} onPress={() => openAgent(a.agentId, a.serverId)}
        style={({ pressed }) => ({ gap: 2, paddingLeft: 10, paddingVertical: 6, borderLeftWidth: 2, borderColor: theme.colors.statusSuccess, borderRadius: 4, backgroundColor: pressed ? theme.colors.surface2 : "transparent" })}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{a.title}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          <Text style={{ color: theme.colors.statusSuccess, fontWeight: "600" }}>{a.status === "initializing" ? "Starting" : "Working"}</Text>
          {[where ? `${where}${hostSuffix(a.serverId)}` : null, a.model || null, ago(a.updatedAt, now)].filter(Boolean).map((x) => ` · ${x}`).join("")}
          {alsoNeedsYou ? <Text style={{ color: theme.colors.statusWarning }}> · also needs you</Text> : null}
        </Text>
      </Pressable>;
    })}
  </View>;
}
