import { SpecialistSchema, type Specialist } from "./settings";

/**
 * A specialist written as a Markdown file: an optional header between "---" lines, then the instructions.
 *
 *   ---
 *   name: Reviewer
 *   description: Independent correctness review
 *   skills: review-style, experiment-checks
 *   model: claude/claude-opus-4-8          (optional; default model otherwise)
 *   read-only: true                         (default true)
 *   mode: plan                              (only with read-only: false)
 *   review: committee                       (single | second-opinion | committee)
 *   second-model: codex/gpt-6.1-sol
 *   ---
 *   You are an independent code reviewer…
 *
 * The id is the file name without ".md" (reviewer.md replaces the built-in Reviewer).
 */
export function parseSpecialistFile(file: string, text: string): { specialist: Specialist } | { error: string } {
  const id = file.replace(/\.md$/i, "").toLowerCase();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const header: Record<string, string> = {};
  for (const line of (match ? match[1]! : "").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const at = line.indexOf(":");
    if (at < 1) return { error: `${file}: header line "${line.trim()}" is not "key: value"` };
    header[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  const known = ["name", "description", "skills", "model", "read-only", "mode", "review", "second-model", "coordinator-only"];
  const unknown = Object.keys(header).filter((k) => !known.includes(k));
  if (unknown.length) return { error: `${file}: unknown header key(s) ${unknown.join(", ")} (known: ${known.join(", ")})` };
  const bool = (key: string, fallback: boolean) => {
    const v = header[key];
    if (v === undefined) return fallback;
    if (v === "true" || v === "false") return v === "true";
    return null;
  };
  const readOnly = bool("read-only", true), coordinatorOnly = bool("coordinator-only", false);
  if (readOnly === null || coordinatorOnly === null) return { error: `${file}: read-only and coordinator-only must be true or false` };
  const parsed = SpecialistSchema.safeParse({
    id, name: header.name || id, description: header.description ?? "", instructions: (match ? match[2]! : text).trim(),
    model: header.model ?? "", modeId: header.mode ?? "", requireReadOnly: readOnly, coordinatorOnly,
    secondOpinionModel: header["second-model"] ?? "", defaultReview: header.review || "single",
    skills: (header.skills ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  if (!parsed.success) return { error: `${file}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "file"} ${i.message}`).join("; ")}` };
  return { specialist: parsed.data };
}

/** Stored specialists with the folder's on top: a folder file replaces the stored one with its id, others are added. */
export function mergeSpecialists(stored: readonly Specialist[], folder: readonly Specialist[]): Specialist[] {
  const byId = new Map(folder.map((s) => [s.id, s]));
  return [...stored.map((s) => byId.get(s.id) ?? s), ...folder.filter((s) => !stored.some((x) => x.id === s.id))];
}

/**
 * Specialists pasted as JSON (Workbench's Export, or a bare array) into the stored list: same id replaces, new ids
 * are added up to the 20-specialist limit. Nothing is applied if any entry is invalid.
 */
export function importSpecialists(stored: readonly Specialist[], json: string): { helpers: Specialist[]; added: number; replaced: number } | { error: string } {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { error: "Not valid JSON." }; }
  const list = Array.isArray(data) ? data : (data as { helpers?: unknown })?.helpers;
  if (!Array.isArray(list) || !list.length) return { error: "Expected Workbench's Export, or a list of specialists." };
  const incoming: Specialist[] = [];
  for (const [i, entry] of list.entries()) {
    const parsed = SpecialistSchema.safeParse(entry);
    if (!parsed.success) return { error: `Specialist ${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}` };
    incoming.push(parsed.data);
  }
  const replaced = incoming.filter((s) => stored.some((x) => x.id === s.id)).length;
  const helpers = mergeSpecialists(stored, incoming);
  if (helpers.length > 20) return { error: `That would make ${helpers.length} specialists; the limit is 20. Delete some first.` };
  return { helpers, added: helpers.length - stored.length, replaced };
}
