import { readFile } from "node:fs/promises";

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

if (!webhookUrl) {
  throw new Error("DISCORD_WEBHOOK_URL を .env に設定してください。");
}

const report = await readFile(new URL("../docs/TECHNICAL_REPORT.md", import.meta.url), "utf8");
const chunks: string[] = [];
let remaining = report;
while (remaining.length > 1_900) {
  const breakAt = Math.max(remaining.lastIndexOf("\n", 1_900), 1);
  chunks.push(remaining.slice(0, breakAt));
  remaining = remaining.slice(breakAt).trimStart();
}
if (remaining) chunks.push(remaining);

for (const content of chunks) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error(`Discord Webhook送信に失敗しました: HTTP ${response.status}`);
}
console.log("技術管理レポートをDiscordへ送信しました。");
