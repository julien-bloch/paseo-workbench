import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { groupProjects, sidebarCounts } from "../shared/model";
import { isCoordinatorHome } from "../shared/settings";
import { directoryForHost, watchAgents } from "./directory";

/** This host's counts, refreshed about a second after any agent changes, and every 15 seconds. Null until read (or unreadable). */
function useCounts(serverId: string) {
  const paseo = usePaseo();
  const [counts, setCounts] = useState<{ attention: number; running: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const dir = await directoryForHost(paseo, serverId);
        if (alive) setCounts(sidebarCounts(dir.agents, groupProjects(dir.workspaces.filter((w) => !isCoordinatorHome(w.directory)), dir.agents)));
      } catch { if (alive) setCounts(null); }
    };
    void load();
    const poll = setInterval(() => void load(), 15_000);
    const unwatch = watchAgents(paseo, () => void load());
    return () => { alive = false; clearInterval(poll); unwatch(); };
  }, [serverId]);
  return counts;
}

/** The Workbench sidebar row, with what needs you (amber) and how many agents are working. */
export function SidebarItem({ currentScreen, openScreen, host, theme }: PluginSidebarItemProps) {
  const counts = useCounts(host.id);
  const badge = (text: string, color: string, filled: boolean, label: string) => <View accessibilityLabel={label}
    style={{ minWidth: 18, paddingHorizontal: 5, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: filled ? color : "transparent", borderWidth: filled ? 0 : 1, borderColor: color }}>
    <Text style={{ fontSize: 10, fontWeight: "700", color: filled ? theme.colors.surface0 : color }}>{text}</Text>
  </View>;
  const trailing = counts && (counts.attention || counts.running) ? <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
    {counts.attention ? badge(String(counts.attention), theme.colors.statusWarning, true, `${counts.attention} need attention`) : null}
    {counts.running ? badge(`▶ ${counts.running}`, theme.colors.foregroundMuted, false, `${counts.running} running`) : null}
  </View> : undefined;
  return <SidebarRow icon="LayoutDashboard" active={currentScreen?.screenId === "workbench"} onPress={() => openScreen({ screenId: "workbench" })} trailing={trailing} />;
}
