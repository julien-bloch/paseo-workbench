import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { ago, hierarchyRows, isReadyToReview, teamArchivable, type AttentionItem, type NativeSubagent, type WorkbenchAgent } from "../shared/model";
import { Button, Checkbox, Notice, Status } from "./ui";

/**
 * Who started what: managed agents nested by Paseo's parent label, provider-native children (live-only) under
 * their parent, and on each node what it is waiting on from you, or that it finished since you last opened it.
 */
export function AgentTree({ theme, agents, native, attention, openAgent, onSummarize, empty, releasable, onRelease, onArchive, watched, onToggleWatched }: {
  theme: PluginTheme; agents: readonly WorkbenchAgent[]; native: readonly NativeSubagent[];
  attention: ReadonlyMap<string, AttentionItem>; openAgent: (agentId: string, serverId: string) => void;
  /** Launch the Session summarizer on a managed agent; omitted where that is not possible. */
  onSummarize?: (agentId: string, serverId: string) => void; empty: string;
  /** Agents that can be released from their coordinator (made top-level again). */
  releasable?: ReadonlySet<string>; onRelease?: (agentId: string) => void;
  /** Archive an agent that is done, with its review team (see shared/model.ts `teamArchivable`); omitted where not offered. */
  onArchive?: (agentId: string, serverId: string) => void;
  /** A checkbox per managed agent: whether Command and the sidebar badge count it (Overview only). "project" when its
   * project is unchecked: shown unchecked and disabled, the project decides. */
  watched?: (agentId: string, serverId: string) => boolean | "project"; onToggleWatched?: (agentId: string, serverId: string) => void;
}) {
  const now = Date.now();
  const color = { permission: theme.colors.statusWarning, error: theme.colors.statusDanger };
  const rows = hierarchyRows(agents, native);
  if (!rows.length) return <Notice theme={theme} text={empty} />;
  return <View>
    {rows.map((row) => {
      const item = row.kind === "managed" ? attention.get(`${row.serverId}:${row.agentId}`) : undefined;
      const agent = row.kind === "managed" ? agents.find((x) => x.agentId === row.agentId && x.serverId === row.serverId) : undefined;
      const mark = item ? { color: color[item.kind], text: item.headline } : agent && isReadyToReview(agent) ? { color: theme.colors.statusSuccess, text: "Finished" } : null;
      return <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`Open ${row.title}`} onPress={() => openAgent(row.agentId, row.serverId)}
        style={({ pressed }) => ({ paddingLeft: Math.min(row.depth, 8) * 14, paddingVertical: 6, borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surface2 : "transparent" })}>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", borderLeftWidth: mark ? 2 : 0, borderColor: mark ? mark.color : "transparent", paddingLeft: mark ? 8 : 0 }}>
          <View style={{ flex: 1, minWidth: 150, gap: 2 }}>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
              {watched && onToggleWatched && row.kind === "managed" ? (() => {
                const on = watched(row.agentId, row.serverId);
                return <View style={{ marginTop: 2 }}><Checkbox theme={theme} checked={on === true} disabled={on === "project"} onPress={() => onToggleWatched(row.agentId, row.serverId)}
                  accessibilityLabel={on === "project" ? `${row.title}: its project is unchecked` : `Show ${row.title} in Command and the sidebar badge`} /></View>;
              })() : null}
              <Text style={{ flexShrink: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: row.depth === 0 ? "600" : "400" }}>{row.depth ? "↳ " : ""}{row.title}</Text>
            </View>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }} numberOfLines={2}>
              {row.kind === "native" ? "Native subagent (read-only, live-only; opens its parent) · " : ""}{[row.subtitle, ago(row.updatedAt, now)].filter(Boolean).join(" · ")}
            </Text>
            <Status theme={theme} status={row.status} />
            {mark ? <Text style={{ color: mark.color, fontSize: 12, fontWeight: "600" }}>{mark.text}</Text> : null}
            {item?.details.map((line, i) => <Text key={i} selectable numberOfLines={2} style={{ color: theme.colors.foreground, fontSize: 11, backgroundColor: theme.colors.surface2, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5 }}>{line}</Text>)}
          </View>
          {onSummarize && row.kind === "managed" ? <Button theme={theme} subtle label="Summarize" onPress={() => onSummarize(row.agentId, row.serverId)} /> : null}
          {onRelease && row.kind === "managed" && releasable?.has(row.agentId) ? <Button theme={theme} subtle label="Release" onPress={() => onRelease(row.agentId)} /> : null}
          {onArchive && agent && teamArchivable(agents, agent) ? <Button theme={theme} subtle label="Archive" onPress={() => onArchive(row.agentId, row.serverId)} /> : null}
        </View>
      </Pressable>;
    })}
  </View>;
}
