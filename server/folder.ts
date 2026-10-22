import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type { preferences } from "../shared/settings";

const MAX_FILES = 30;
const MAX_BYTES = 64_000;

/** Read the specialists folder named in settings: its *.md files (not subfolders), each up to 64 KB. */
export async function readSpecialistsFolder(settings: PluginSettings<typeof preferences.schema>) {
  const state = await settings.read();
  const raw = state.status === "ready" ? state.values.specialistsFolder.trim() : "";
  if (!raw) return { folder: "", files: [] };
  const folder = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
  if (!isAbsolute(folder)) return { folder, files: [], error: "Use an absolute path (or one starting with ~/)." };
  try {
    const names = (await readdir(folder)).filter((n) => n.toLowerCase().endsWith(".md") && !n.startsWith(".") && n.toLowerCase() !== "readme.md").sort().slice(0, MAX_FILES);
    const files: { file: string; text: string }[] = [];
    for (const file of names) {
      const path = join(folder, file);
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_BYTES) continue;
      files.push({ file, text: await readFile(path, "utf8") });
    }
    return { folder, files };
  } catch (error) {
    return { folder, files: [], error: (error as NodeJS.ErrnoException).code === "ENOENT" ? "Folder not found on this host." : String((error as Error).message) };
  }
}
