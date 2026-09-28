import { chromium } from "playwright";

const utterances = [
  "今日はイベント形式について決めます",
  "スマホで集客しやすいので、対戦ゲーム形式で進めましょう",
  "対戦ゲーム形式を採用します",
  "ランキング機能については、保留にしておきましょう",
  "鈴木さんがプロトタイプを来週金曜日までに作成します",
  "いい質問ですね。そこはまだ検討中です。青チームで検証します",
  "昨日のスプリントタスクは完了しました。ただし、APIレスポンスが予想より遅くて、パフォーマンステストをやり直す必要があります",
];

const results = { steps: [], errors: [], consoleErrors: [] };
const shotDir = "/private/tmp/claude-501/-Users-yuuto-lab-speak-attension/f43bfca3-ea63-4da2-9de4-5edc6f7f4a10/scratchpad/pw-shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

page.on("console", (msg) => {
  if (msg.type() === "error") results.consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => results.errors.push(String(err)));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.screenshot({ path: `${shotDir}/01-initial.png` });
results.steps.push("loaded index");

// Open the input dock / manual tab and submit utterances one by one.
for (let i = 0; i < utterances.length; i++) {
  const textarea = page.locator("#manualText");
  await textarea.waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
  if (await textarea.count() === 0) {
    results.errors.push(`manualText textarea not found before utterance ${i}`);
    break;
  }
  await textarea.fill(utterances[i]);
  await page.locator('button[aria-label="手動発話を投入"]').click();
  await page.waitForTimeout(200);
}
results.steps.push(`submitted ${utterances.length} utterances`);
await page.screenshot({ path: `${shotDir}/02-after-input.png` });

// Open "別のマップ・詳細表示" -> "会話マップ"
const detailsToggle = page.locator("details.map-alternatives summary");
if (await detailsToggle.count() > 0) {
  await detailsToggle.click();
  await page.waitForTimeout(150);
  const liveButton = page.locator('button:has-text("会話マップ")').first();
  if (await liveButton.count() > 0) {
    await liveButton.click();
    results.steps.push("clicked 会話マップ");
  } else {
    results.errors.push("会話マップ button not found");
  }
} else {
  results.errors.push("map-alternatives details not found");
}
await page.waitForTimeout(300);
await page.screenshot({ path: `${shotDir}/03-conversation-map.png` });

// Switch to the Timeline tab within ConversationView
const timelineTab = page.locator('button[role="tab"]:has-text("タイムライン")');
if (await timelineTab.count() > 0) {
  await timelineTab.click();
  results.steps.push("clicked タイムライン tab");
} else {
  results.errors.push("タイムライン tab not found");
}
await page.waitForTimeout(300);
await page.screenshot({ path: `${shotDir}/04-timeline.png`, fullPage: true });

// Inspect rendered structure
const rowCount = await page.locator("li.timeline-row").count();
const unitCount = await page.locator("li.timeline-unit").count();
const scopeChips = await page.locator(".semantic-badge-scope").allTextContents();
const basisChips = await page.locator(".semantic-badge-basis").allTextContents();
results.rowCount = rowCount;
results.unitCount = unitCount;
results.scopeChips = scopeChips;
results.basisChips = basisChips;

// Check units-per-row grouping (utterance #2 should have 2 units, #7 should have 3)
const rows = await page.locator("li.timeline-row").all();
const perRowUnitCounts = [];
for (const row of rows) {
  const n = await row.locator("li.timeline-unit").count();
  const text = await row.locator(".timeline-label").first().textContent().catch(() => null);
  perRowUnitCounts.push({ text: text?.slice(0, 40), units: n });
}
results.perRowUnitCounts = perRowUnitCounts;

// Try the correction dropdown on the first unit
const firstUnit = page.locator("li.timeline-unit").first();
if (await firstUnit.count() > 0) {
  const selects = firstUnit.locator("select");
  const selectCount = await selects.count();
  results.correctionSelectCount = selectCount;
  if (selectCount >= 2) {
    const roleSelect = selects.nth(0);
    const beforeValue = await roleSelect.inputValue();
    const options = await roleSelect.locator("option").allTextContents();
    // pick a different option than current
    const optValues = await roleSelect.locator("option").evaluateAll((opts) => opts.map((o) => o.value));
    const targetValue = optValues.find((v) => v !== beforeValue) ?? optValues[0];
    await roleSelect.selectOption(targetValue);
    await page.waitForTimeout(200);
    const afterValue = await roleSelect.inputValue();
    results.correctionTest = { beforeValue, targetValue, afterValue, changed: beforeValue !== afterValue };

    // check "修正済み" badge appeared
    const correctedBadge = await firstUnit.locator(".timeline-correction-badge").count();
    results.correctedBadgeAppeared = correctedBadge > 0;

    // check row did NOT get selected (button click leakage) by checking aria state
    const rowLi = page.locator("li.timeline-row").first();
    const rowClass = await rowLi.getAttribute("class");
    results.rowClassAfterCorrection = rowClass;
  }
}
await page.screenshot({ path: `${shotDir}/05-after-correction.png`, fullPage: true });

// Switch to graph view and back to verify correction persists
const graphTab = page.locator('button[role="tab"]:has-text("関係を見る")');
if (await graphTab.count() > 0) {
  await graphTab.click();
  await page.waitForTimeout(200);
  await timelineTab.click();
  await page.waitForTimeout(200);
  const badgeAfterToggle = await page.locator("li.timeline-unit").first().locator(".timeline-correction-badge").count();
  results.correctionSurvivesTabToggle = badgeAfterToggle > 0;
}
await page.screenshot({ path: `${shotDir}/06-after-toggle.png`, fullPage: true });

console.log(JSON.stringify(results, null, 2));
await browser.close();
