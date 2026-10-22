import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";

/**
 * Enough Markdown for agent replies: headings, bold, inline code, fenced code, bullets, quotes.
 * Tables and anything else stay as their plain text, which is still readable. Selectable for copying.
 */
export function Markdown({ theme, text }: { theme: PluginTheme; text: string }) {
  const blocks: { code: boolean; lines: string[] }[] = [];
  let inCode = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) { inCode = !inCode; blocks.push({ code: inCode, lines: [] }); continue; }
    const last = blocks[blocks.length - 1];
    if (last && last.code === inCode) last.lines.push(line);
    else blocks.push({ code: inCode, lines: [line] });
  }
  return <View style={{ gap: 4 }}>
    {blocks.map((block, b) => block.code
      ? block.lines.length ? <Text key={b} selectable style={{ color: theme.colors.foreground, fontSize: 12, backgroundColor: theme.colors.surface2, padding: 8, borderRadius: 6 }}>{block.lines.join("\n")}</Text> : null
      : block.lines.map((line, i) => {
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
        const quote = /^>\s?(.*)$/.exec(line);
        const body = heading ? heading[2]! : bullet ? `• ${bullet[2]}` : quote ? quote[1]! : line;
        return <Text key={`${b}:${i}`} selectable style={{ color: quote ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: heading ? 15 : 13, fontWeight: heading ? "700" : "400", lineHeight: heading ? 22 : 19, paddingLeft: bullet ? 8 + (bullet[1]!.length * 4) : quote ? 8 : 0 }}>
          {inline(theme, body)}
        </Text>;
      }))}
  </View>;
}

/** **bold** and `code` spans; everything else as typed. */
function inline(theme: PluginTheme, text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <Text key={i} style={{ fontWeight: "700" }}>{part.slice(2, -2)}</Text>
    : part.startsWith("`") && part.endsWith("`") ? <Text key={i} style={{ backgroundColor: theme.colors.surface2, fontSize: 12 }}>{part.slice(1, -1)}</Text>
    : <Text key={i}>{part}</Text>);
}
