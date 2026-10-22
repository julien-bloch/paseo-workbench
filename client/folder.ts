import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { folderSpecialists } from "../shared/rpc";
import type { Specialist } from "../shared/settings";
import { parseSpecialistFile } from "../shared/specialistFiles";

export type FolderState = { folder: string; specialists: Specialist[]; files: Record<string, string>; problems: string[]; error: string; reload: () => void };

/** The specialists in the folder set in Settings, re-read every 30 seconds while shown, so file edits apply without saving. */
export function useFolderSpecialists(folderSetting: string): FolderState {
  const read = useRpc(folderSpecialists);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<FolderState, "reload">>({ folder: "", specialists: [], files: {}, problems: [], error: "" });
  useEffect(() => {
    if (!folderSetting.trim()) { setState({ folder: "", specialists: [], files: {}, problems: [], error: "" }); return; }
    let alive = true;
    const load = () => read({}).then((r) => {
      if (!alive) return;
      const specialists: Specialist[] = [], problems: string[] = [], files: Record<string, string> = {};
      for (const f of r.files) {
        const parsed = parseSpecialistFile(f.file, f.text);
        if ("error" in parsed) problems.push(parsed.error);
        else { specialists.push(parsed.specialist); files[parsed.specialist.id] = f.file; }
      }
      setState({ folder: r.folder, specialists, files, problems, error: r.error ?? (r.files.length ? "" : "No .md files in this folder.") });
    }).catch((e) => { if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })); });
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [folderSetting, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
