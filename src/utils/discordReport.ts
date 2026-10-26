const maxChunkLength = 1800;
const maxParts = 40;

// Discord messages are limited to 2000 UTF-16 code units. Keep room for a
// numbered header and never split a surrogate pair in the report text.
export function splitDiscordReport(markdown: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of markdown) {
    if (chunk.length + character.length > maxChunkLength) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > maxParts) throw new Error(`Discordへ送れるレポートは最大${maxParts}件分です。Markdownとして保存してください。`);
  return chunks.map((text, index) => `[会議レポート ${index + 1}/${chunks.length}]\n${text}`);
}
