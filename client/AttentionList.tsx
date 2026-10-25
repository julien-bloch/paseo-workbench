import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { ago, type AttentionGroup } from "../shared/model";

/** What needs you, grouped by project, most urgent first. Tap an item to open that agent. */
export function AttentionList({ theme, groups, hostSuffix, openAgent }: {
  theme: PluginTheme; groups: readonly AttentionGroup[]; hostSuffix: (serverId: string | null) => string; openAgent: (agentId: string, serverId: string) => void;
}) {
  const now = Date.now();
  const color = { permission: theme.colors.statusWarning, error: theme.colors.statusDanger };
  let shown = 0;
  return <View style={{ gap: 10 }}>
    {groups.map((group) => {
      const items = group.items.slice(0, Math.max(0, 30 - shown));
      shown += items.length;
      if (!items.length) return null;
      return <View key={group.key} style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>{group.name}{hostSuffix(group.serverId)}{group.items.length > items.length ? ` · ${group.items.length - items.length} more not shown` : ""}</Text>
        {items.map((item) => <Pressable key={`${item.serverId}:${item.agentId}`} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => openAgent(item.agentId, item.serverId)}
          style={({ pressed }) => ({ gap: 3, paddingLeft: 10, paddingVertical: 6, borderLeftWidth: 2, borderColor: color[item.kind], borderRadius: 4, backgroundColor: pressed ? theme.colors.surface2 : "transparent" })}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{item.title}</Text>
          <Text style={{ color: color[item.kind], fontSize: 12, fontWeight: "600" }}>{item.headline}<Text style={{ color: theme.colors.foregroundMuted, fontWeight: "400" }}>{[item.via ? `started by ${item.via}` : null, item.workspaceName, ago(item.since, now)].filter(Boolean).map((x) => ` · ${x}`).join("")}</Text></Text>
          {item.details.map((line, i) => <Text key={i} selectable numberOfLines={3} style={{ color: theme.colors.foreground, fontSize: 11, backgroundColor: theme.colors.surface2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>{line}</Text>)}
        </Pressable>)}
      </View>;
    })}
  </View>;
}
