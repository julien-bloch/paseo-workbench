import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { listSchedules, scheduleAction, type ScheduleRow } from "../shared/rpc";
import { Button, Notice, Section, Wrap } from "./ui";

/** The schedules and check-ins Workbench created on the selected host. `version` changes when a new one was added. */
export function Schedules({ theme, version }: { theme: PluginTheme; version: number }) {
  const list = useRpc(listSchedules);
  const act = useRpc(scheduleAction);
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() {
    try { setRows((await list({})).schedules); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void load(); }, [version]);
  async function run(id: string, action: "pause" | "resume" | "delete") {
    setBusy(id);
    try { await act({ id, action }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  if (!rows?.length && !error) return null;
  return <Section theme={theme} title="Schedules" subtitle="Created by Workbench on this host. Paseo runs them while the daemon is up.">
    {error ? <Notice theme={theme} kind="error" text={`Could not read schedules: ${error}`} /> : null}
    {(rows ?? []).map((r) => <View key={r.id} style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{r.name.replace(/^Workbench: /, "")}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {r.kind === "check-in" ? "Check-in · " : "New agent each run · "}{r.cadence} · {r.status}{r.nextRunAt ? ` · next ${new Date(r.nextRunAt).toLocaleString()}` : ""}
      </Text>
      <Wrap>
        {r.kind === "workspace" ? <Button theme={theme} subtle disabled={busy === r.id} label={r.status === "paused" ? "Resume" : "Pause"} onPress={() => void run(r.id, r.status === "paused" ? "resume" : "pause")} /> : null}
        <Button theme={theme} subtle disabled={busy === r.id} label="Delete" onPress={() => void run(r.id, "delete")} />
      </Wrap>
    </View>)}
  </Section>;
}
