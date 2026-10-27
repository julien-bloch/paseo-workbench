import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { groupProjects, sidebarCounts, watchedAgents, type WorkbenchAgent, type WorkbenchWorkspace } from "../shared/model";
import { isCoordinatorHome, preferences } from "../shared/settings";
import { directoryForHost, watchAgents } from "./directory";

/** This host's agents, refreshed about a second after any agent changes, and every 15 seconds. Null until read (or unreadable). */
function useHostDirectory(serverId: string) {
  const paseo = usePaseo();
  const [dir, setDir] = useState<{ agents: WorkbenchAgent[]; workspaces: WorkbenchWorkspace[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const read = await directoryForHost(paseo, serverId);
        if (alive) setDir(read);
      } catch { if (alive) setDir(null); }
    };
    void load();
    const poll = setInterval(() => void load(), 15_000);
    const unwatch = watchAgents(paseo, () => void load());
    return () => { alive = false; clearInterval(poll); unwatch(); };
  }, [serverId]);
  return dir;
}

/**
 * Paseo's status dot colours (its theme's statusDot*, Paseo 0.13), which the plugin theme does not expose: its
 * statusWarning/statusSuccess are muted variants and it has no running blue.
 * shortcut: copied values, picked by the theme's background; update them if Paseo's change.
 */
const DOTS = {
  light: { needsInput: "#b37824", failed: "#f12e2f", running: "#268ae0", finished: "#299f51" },
  dark: { needsInput: "#db932e", failed: "#f7796d", running: "#5caaf6", finished: "#35c264" },
};
function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return true; // Paseo's default theme is dark
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128;
}
/** Left to right: what needs you (asking, then failed), what finished, what is working; Paseo's words (subagent pills) and the shape its sidebar draws for each. */
const BUCKETS = [["needsInput", "needs input", "alert"], ["failed", "failed", "dot"], ["finished", "ready to review", "dot"], ["running", "working", "ring"]] as const;

/** The Workbench sidebar row, with a count per Paseo status (dot colour as in Paseo's sidebar) for agents on this host. */
export function SidebarItem({ currentScreen, openScreen, host, theme }: PluginSidebarItemProps) {
  const dir = useHostDirectory(host.id);
  const settings = useSettings(preferences);
  // Only agents checked in Overview count; until settings load, every agent does.
  const unwatched = settings.status === "ready" ? { agents: settings.values.unwatchedAgents, projects: settings.values.unwatchedProjects } : { agents: [], projects: [] };
  const agents = dir ? watchedAgents(dir.agents, dir.workspaces, unwatched) : null;
  const counts = dir && agents ? sidebarCounts(agents, groupProjects(dir.workspaces.filter((w) => !isCoordinatorHome(w.directory)), agents)) : null;
  const dots = DOTS[isDark(theme.colors.surface0) ? "dark" : "light"];
  const shown = counts ? BUCKETS.filter(([key]) => counts[key] > 0) : [];
  const trailing = counts && shown.length ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
    {shown.map(([key, words, shape]) => <View key={key} accessibilityLabel={`${counts[key]} ${words}`} style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      {/* Paseo's marks, sizes measured against its sidebar: a filled circle with "!" (Lucide CircleAlert) when asking; a dot
          in a faint spinner track while working (Paseo's arc moves, this one is still); a dot otherwise. */}
      {shape === "alert" ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: dots[key], alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 1, height: 3, borderRadius: 0.5, backgroundColor: theme.colors.surface0 }} />
          <View style={{ width: 1, height: 1, marginTop: 1, borderRadius: 0.5, backgroundColor: theme.colors.surface0 }} />
        </View>
        : shape === "ring" ? <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: `${dots[key]}4d`, borderTopColor: dots[key], alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dots[key] }} />
        </View>
        : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dots[key] }} />}
      <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foregroundMuted }}>{counts[key]}</Text>
    </View>)}
  </View> : undefined;
  return <SidebarRow icon="LayoutDashboard" active={currentScreen?.screenId === "workbench"} onPress={() => openScreen({ screenId: "workbench" })} trailing={trailing} />;
}
