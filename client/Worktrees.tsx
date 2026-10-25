import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ago } from "../shared/model";
import { listWorktrees, removeWorktree, type WorktreeRow } from "../shared/rpc";
import { Button, Notice, Section, Wrap } from "./ui";

/**
 * Worktree workspaces on the selected host, with what removing each would lose. Remove uses Paseo's own workspace
 * archive: the folder is deleted, the branch stays, its agents are archived. `version` changes after an archive.
 */
export function Worktrees({ theme, version }: { theme: PluginTheme; version: number }) {
  const list = useRpc(listWorktrees);
  const remove = useRpc(removeWorktree);
  const [rows, setRows] = useState<WorktreeRow[] | null>(null);
  const [note, setNote] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState("");
  async function load() {
    try { setRows((await list({})).worktrees); }
    catch (e) { setNote({ kind: "error", text: `Could not read worktrees: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  useEffect(() => { void load(); }, [version]);
  async function run(w: WorktreeRow) {
    if (confirm !== w.workspaceId) { setConfirm(w.workspaceId); return; }
    setConfirm(""); setBusy(w.workspaceId);
    try {
      const r = await remove({ workspaceId: w.workspaceId, mode: w.dirty ? "discard" : "clean-only" });
      setNote(r.removed ? { kind: "success", text: `Removed ${w.name}. Its branch is kept.` } : { kind: "error", text: `${w.name} not removed: ${r.reason}.` });
      await load();
    } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(""); }
  }
  if (!rows?.length && !note) return null;
  const now = Date.now();
  return <Section theme={theme} title={`Worktrees (${rows?.length ?? 0})`} subtitle="Git worktrees Paseo created on this host. Removing one deletes its folder (the branch stays) and archives its agents, as Paseo's own archive does.">
    {note ? <Notice theme={theme} {...note} /> : null}
    {(rows ?? []).map((w) => <View key={w.workspaceId} style={{ gap: 4, paddingBottom: 8, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{w.project} / {w.name}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {[w.running ? `${w.running} working` : w.agents ? `${w.agents} idle agent${w.agents === 1 ? "" : "s"}` : "no agents", w.activityAt ? `active ${ago(w.activityAt, now)}` : null, w.prReview ? "Workbench PR review" : null].filter(Boolean).join(" · ")}
      </Text>
      {w.dirty ? <Text style={{ color: theme.colors.statusWarning, fontSize: 11, fontWeight: "600" }}>Uncommitted changes: removing it discards them.</Text> : null}
      {w.ignored.length ? <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>Ignored files removing it deletes too: {w.ignored.slice(0, 6).join(", ")}{w.ignored.length > 6 ? ` and ${w.ignored.length - 6} more` : ""}</Text> : null}
      <Wrap>
        <Button theme={theme} subtle disabled={w.running > 0 || busy === w.workspaceId}
          label={confirm === w.workspaceId ? (w.dirty ? "Confirm: discard changes and remove" : w.agents ? `Confirm: remove and archive its ${w.agents} agent${w.agents === 1 ? "" : "s"}` : "Confirm: remove") : "Remove"}
          onPress={() => void run(w)} />
        {confirm === w.workspaceId ? <Button theme={theme} subtle label="Cancel" onPress={() => setConfirm("")} /> : null}
      </Wrap>
    </View>)}
  </Section>;
}
