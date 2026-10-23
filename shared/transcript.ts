import { permissionSummary } from "./model";

/** One row of a rendered conversation. Pure, so the chat view stays a thin renderer. */
export type TranscriptRow =
  | { kind: "user"; key: string; text: string }
  | { kind: "workbench"; key: string; title: string; text: string }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "tool"; key: string; text: string; status: string }
  | { kind: "error"; key: string; text: string };

type Item = { type: string; text?: string; message?: string; error?: string; name?: string; status?: string; detail?: unknown };

/** Messages Workbench itself sends (relays, context refreshes, first prompts) start like this. */
const WORKBENCH_PREFIXES = ["[Workbench", "I refreshed your Workbench context", "You are the Workbench Coordinator"];

/**
 * Timeline items (oldest first) to chat rows: your messages, Workbench's own messages (shown apart, collapsed),
 * the agent's replies, one line per tool call, and failures. Reasoning and bookkeeping items are left out.
 */
export function transcriptRows(items: readonly Item[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  items.forEach((item, i) => {
    const key = `${i}`;
    switch (item.type) {
      case "user_message": {
        const text = item.text ?? "";
        if (WORKBENCH_PREFIXES.some((p) => text.startsWith(p))) {
          // The row is already labelled Workbench; drop a leading "[Workbench] " from its title.
          rows.push({ kind: "workbench", key, title: text.split("\n")[0]!.replace(/^\[Workbench\]\s*/, "").slice(0, 120), text });
        } else rows.push({ kind: "user", key, text });
        break;
      }
      case "assistant_message": {
        const last = rows[rows.length - 1];
        // Streaming can split one reply into several items; show it as one.
        if (last?.kind === "assistant") last.text += item.text ?? "";
        else rows.push({ kind: "assistant", key, text: item.text ?? "" });
        break;
      }
      case "tool_call":
        rows.push({ kind: "tool", key, text: permissionSummary({ name: item.name ?? "tool", detail: item.detail }), status: item.status ?? "" });
        break;
      case "error":
        rows.push({ kind: "error", key, text: item.message ?? "Error" });
        break;
      case "turn_failed":
        rows.push({ kind: "error", key, text: `Turn failed: ${item.error ?? "unknown error"}` });
        break;
    }
  });
  return rows;
}

/** A conversation as plain text for another agent to read, newest kept when it must be cut. */
export function transcriptText(rows: readonly TranscriptRow[], maxChars = 60_000): string {
  const text = rows.map((r) =>
    r.kind === "user" ? `User: ${r.text}` : r.kind === "assistant" ? `Agent: ${r.text}` : r.kind === "workbench" ? `Workbench: ${r.title}`
    : r.kind === "tool" ? `  [tool ${r.status}] ${r.text}` : `Error: ${r.text}`).join("\n\n");
  return text.length <= maxChars ? text : `(earlier part omitted)\n…${text.slice(text.length - maxChars)}`;
}
