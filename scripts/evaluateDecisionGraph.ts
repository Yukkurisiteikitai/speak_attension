// Scores appendMeetingDecisionSegment against hand-checkable per-utterance labels
// and writes a Markdown report. The labels live in eval-data/ (gitignored).
//   pnpm run decision:eval              dev split only
//   pnpm run decision:eval -- --holdout holdout split only (run once, after tuning)
//   pnpm run decision:eval -- --all     both
//   pnpm run decision:eval -- --data <file.json>  any labelled file (items without a split are all scored)
import fs from "fs";
import path from "path";
import { appendMeetingDecisionSegment, createInitialMeetingDecisionGraph } from "../src/utils/meetingDecisionGraph";
import type { AnalyzedSegment } from "../src/types/topic";

type Item = { id: string; split?: "dev" | "holdout"; category: string; text: string; expect: string[]; reviewed?: boolean };

const dataArg = process.argv.indexOf("--data");
const dataPath = dataArg >= 0 ? path.resolve(process.argv[dataArg + 1]) : path.join(process.cwd(), "eval-data", "decision-graph.json");
if (!fs.existsSync(dataPath)) {
  console.error(`Missing ${dataPath}. The labelled data is intentionally not committed.`);
  process.exit(1);
}
const flag = dataArg >= 0 || process.argv.includes("--all") ? "all" : process.argv.includes("--holdout") ? "holdout" : "dev";
const items = (JSON.parse(fs.readFileSync(dataPath, "utf8")) as Item[]).filter((item) => flag === "all" || !item.split || item.split === flag);

function predict(text: string): string[] {
  const segment = { id: "e", text, createdAt: 0, source: "manual", matchedTopicIds: [], analysis: {} } as unknown as AnalyzedSegment;
  const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment);
  return graph.nodes.filter((node) => node.type !== "utterance").map((node) => `${node.type}:${node.state}`).sort();
}

const results = items.map((item) => {
  const actual = predict(item.text);
  const expected = [...item.expect].sort();
  return { item, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) };
});

const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(0)}% (${n}/${d})`);
const cell = (kinds: string[]) => (kinds.length ? kinds.map((k) => `\`${k}\``).join(" + ") : "なし");
const esc = (text: string) => text.replace(/\|/g, "\\|");
const lines: string[] = [];

lines.push(`# 決定グラフ評価レポート`, "", `- 対象: **${flag}**（${items.length}発話）`, `- 生成: ${new Date().toISOString()}`);
if (flag !== "dev") lines.push("- ⚠ holdout を含みます。結果を見て規則を直した場合、この holdout はもう未使用ではありません。");
const unreviewed = items.filter((item) => !item.reviewed).length;
lines.push(`- 人による確認済みラベル: ${items.length - unreviewed}/${items.length}${unreviewed ? "（未確認のラベルは正解とは限りません）" : ""}`, "");

const exact = results.filter((r) => r.ok).length;
lines.push("## 総合", "", `発話ごとの完全一致: **${pct(exact, results.length)}**`, "");

// Node-level precision / recall per "type:state", counted once per utterance.
const kinds = [...new Set(results.flatMap((r) => [...r.item.expect, ...r.actual]))].sort();
lines.push("## ノード種別ごと", "", "| 種別 | 適合率 | 再現率 | 見逃し | 誤検出 |", "|---|---|---|---|---|");
for (const kind of kinds) {
  const tp = results.filter((r) => r.item.expect.includes(kind) && r.actual.includes(kind)).length;
  const fn = results.filter((r) => r.item.expect.includes(kind) && !r.actual.includes(kind)).length;
  const fp = results.filter((r) => !r.item.expect.includes(kind) && r.actual.includes(kind)).length;
  lines.push(`| \`${kind}\` | ${pct(tp, tp + fp)} | ${pct(tp, tp + fn)} | ${fn} | ${fp} |`);
}
const shouldBeEmpty = results.filter((r) => r.item.expect.length === 0);
lines.push("", `何も出さないはずの発話で、余計なノードが出た割合: **${pct(shouldBeEmpty.filter((r) => !r.ok).length, shouldBeEmpty.length)}**`, "");

lines.push("## カテゴリごと", "", "| カテゴリ | 一致 |", "|---|---|");
for (const category of [...new Set(items.map((i) => i.category))]) {
  const rs = results.filter((r) => r.item.category === category);
  lines.push(`| ${category} | ${pct(rs.filter((r) => r.ok).length, rs.length)} |`);
}

const failures = results.filter((r) => !r.ok);
lines.push("", `## 不一致（${failures.length}件）`, "", "| ID | カテゴリ | 発話 | 期待 | 実際 |", "|---|---|---|---|---|");
for (const r of failures) lines.push(`| ${r.item.id} | ${r.item.category} | ${esc(r.item.text)} | ${cell(r.item.expect)} | ${cell(r.actual)} |`);

lines.push("", "## 全件（ラベル確認用）", "", "| | ID | 区分 | カテゴリ | 発話 | 期待 | 実際 | 確認済 |", "|---|---|---|---|---|---|---|---|");
for (const r of results) lines.push(`| ${r.ok ? "✅" : "❌"} | ${r.item.id} | ${r.item.split ?? "-"} | ${r.item.category} | ${esc(r.item.text)} | ${cell(r.item.expect)} | ${cell(r.actual)} | ${r.item.reviewed ? "✔" : ""} |`);

const out = path.join(process.cwd(), "logs", dataArg >= 0 ? `decision-eval-${path.basename(dataPath, ".json")}.md` : "decision-eval.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`${flag}: exact ${pct(exact, results.length)}, mismatches ${failures.length}`);
console.log(`Report: ${out}`);
