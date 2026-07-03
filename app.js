const TOPICS = [
  {
    id: "source",
    label: "根拠ソース",
    terms: ["ソース", "根拠", "引用", "発言", "どこ", "参照", "番号", "source"],
  },
  {
    id: "topic-shift",
    label: "話題転換",
    terms: ["話題", "議題", "変わ", "転換", "脱線", "戻", "検知", "切れ目"],
  },
  {
    id: "issue-answer",
    label: "課題と回答",
    terms: ["課題", "問題", "未回答", "回答", "答え", "解決", "残", "整理"],
  },
  {
    id: "stt",
    label: "音声認識",
    terms: ["音声", "マイク", "字幕", "文字起こし", "stt", "asr", "speech"],
  },
  {
    id: "ui",
    label: "UI表示",
    terms: ["表示", "強調", "カード", "ハイライト", "notebooklm", "画面", "ui"],
  },
];

const ANSWER_HINTS = ["解決", "対応", "答え", "結論", "なので", "ために", "すれば", "として", "方針", "実装"];
const ISSUE_HINTS = ["課題", "問題", "懸念", "難しい", "できない", "必要", "不足", "未回答", "どう", "なぜ", "どこ"];
const SAMPLE_LINES = [
  "課題は、議論中に情報がどの発言をソースにしているのか分からないことです。",
  "解決策として、各発言にS1、S2の番号を付けて、論点カード側に引用元として表示します。",
  "次の話題です。話題が変わったタイミングを検知して、今どの論点にいるかを強調したいです。",
  "これは発話のキーワードが前の話題と大きく変わった時に、話題転換として扱えばよさそうです。",
  "まだ未回答なのは、議論終了時に答えていない課題をどう強調するかです。",
  "終了時には、回答済みは緑、未回答は赤で並べ、根拠の発言番号も残します。",
];

const state = {
  recognition: null,
  running: false,
  startedAt: null,
  timerId: null,
  flushId: null,
  buffer: "",
  sources: [],
  issues: [],
  currentTopicId: null,
  shiftCount: 0,
};

const els = {
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  supportBadge: document.querySelector("#supportBadge"),
  timer: document.querySelector("#timer"),
  currentTopic: document.querySelector("#currentTopic"),
  shiftCount: document.querySelector("#shiftCount"),
  issueCount: document.querySelector("#issueCount"),
  answeredCount: document.querySelector("#answeredCount"),
  openCount: document.querySelector("#openCount"),
  interimTranscript: document.querySelector("#interimTranscript"),
  sourceList: document.querySelector("#sourceList"),
  issueBoard: document.querySelector("#issueBoard"),
  manualInput: document.querySelector("#manualInput"),
  finalSummary: document.querySelector("#finalSummary"),
  jsonLog: document.querySelector("#jsonLog"),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function init() {
  wireEvents();
  updateSupportBadge();
  render();
}

function wireEvents() {
  els.startBtn.addEventListener("click", startRecognition);
  els.stopBtn.addEventListener("click", finishDiscussion);
  els.sampleBtn.addEventListener("click", playSamples);
  els.resetBtn.addEventListener("click", resetDiscussion);
  els.analyzeBtn.addEventListener("click", () => {
    const text = els.manualInput.value.trim();
    if (!text) return;
    addSource(text, "manual");
    els.manualInput.value = "";
  });
  els.downloadBtn.addEventListener("click", downloadLog);
}

function updateSupportBadge() {
  if (SpeechRecognition) {
    els.supportBadge.textContent = "音声認識対応";
    return;
  }
  els.supportBadge.textContent = "手入力のみ";
  els.startBtn.disabled = true;
}

function startRecognition() {
  if (!SpeechRecognition || state.running) return;

  state.recognition = new SpeechRecognition();
  state.recognition.lang = "ja-JP";
  state.recognition.continuous = true;
  state.recognition.interimResults = true;

  state.recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        state.buffer += `${transcript} `;
        els.interimTranscript.textContent = transcript;
      } else {
        interim += transcript;
      }
    }
    if (interim) els.interimTranscript.textContent = interim;
  };

  state.recognition.onerror = (event) => {
    els.interimTranscript.textContent = `音声認識エラー: ${event.error}`;
  };

  state.recognition.onend = () => {
    if (state.running) state.recognition.start();
  };

  state.running = true;
  state.startedAt = Date.now();
  state.recognition.start();
  state.timerId = window.setInterval(updateTimer, 500);
  state.flushId = window.setInterval(flushBuffer, 6000);
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.interimTranscript.textContent = "聞き取り中...";
}

function finishDiscussion() {
  if (state.running) {
    state.running = false;
    state.recognition?.stop();
    window.clearInterval(state.timerId);
    window.clearInterval(state.flushId);
    flushBuffer();
    els.startBtn.disabled = !SpeechRecognition;
  }
  buildFinalSummary();
}

function resetDiscussion() {
  if (state.running) finishDiscussion();
  state.sources = [];
  state.issues = [];
  state.currentTopicId = null;
  state.shiftCount = 0;
  state.buffer = "";
  els.timer.textContent = "00:00";
  els.interimTranscript.textContent = "音声入力、または手入力で発話を追加してください。";
  els.finalSummary.innerHTML = "<p>議論を終了すると、課題と回答状況をここに整理します。</p>";
  render();
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  els.timer.textContent = `${minutes}:${seconds}`;
}

function flushBuffer() {
  const text = state.buffer.trim();
  if (!text) return;
  state.buffer = "";
  addSource(text, "speech");
}

function addSource(text, sourceType) {
  const source = {
    id: state.sources.length + 1,
    label: `S${state.sources.length + 1}`,
    text,
    sourceType,
    at: new Date().toISOString(),
  };
  const topic = detectTopic(text);
  const previousTopicId = state.currentTopicId;
  const shifted = previousTopicId && previousTopicId !== topic.id;
  if (shifted) state.shiftCount += 1;
  state.currentTopicId = topic.id;

  const issue = upsertIssue(text, source, topic, shifted);
  source.topicId = topic.id;
  source.topicLabel = topic.label;
  source.issueId = issue.id;
  source.shifted = Boolean(shifted);
  state.sources.push(source);
  render();
}

function detectTopic(text) {
  const normalized = text.toLowerCase();
  const ranked = TOPICS.map((topic) => ({
    ...topic,
    score: topic.terms.reduce((sum, term) => sum + (normalized.includes(term.toLowerCase()) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  if (ranked[0].score > 0) return ranked[0];
  return { id: `free-${compactLabel(text)}`, label: compactLabel(text), terms: [] };
}

function upsertIssue(text, source, topic, shifted) {
  const kind = classifySentence(text);
  const existing = state.issues.find((issue) => issue.topicId === topic.id && issue.status !== "answered");
  const shouldCreate = !existing || shifted || kind === "issue";
  const issue =
    shouldCreate
      ? createIssue(text, source, topic, kind)
      : existing;

  if (!shouldCreate) {
    issue.sources.push(source.label);
    issue.evidence.push({ source: source.label, text });
  }

  if (kind === "answer") {
    issue.status = "answered";
    issue.answer = summarizeAnswer(text);
    issue.answerSources = [...new Set([...(issue.answerSources || []), source.label])];
  } else if (kind === "issue" && issue.status !== "answered") {
    issue.status = "open";
  }

  issue.updatedAt = source.at;
  return issue;
}

function createIssue(text, source, topic, kind) {
  const issue = {
    id: `I${state.issues.length + 1}`,
    topicId: topic.id,
    topicLabel: topic.label,
    title: buildIssueTitle(text, topic.label, kind),
    status: kind === "answer" ? "answered" : "open",
    issue: kind === "answer" ? "" : summarizeIssue(text),
    answer: kind === "answer" ? summarizeAnswer(text) : "",
    sources: [source.label],
    answerSources: kind === "answer" ? [source.label] : [],
    evidence: [{ source: source.label, text }],
    createdAt: source.at,
    updatedAt: source.at,
  };
  state.issues.push(issue);
  return issue;
}

function classifySentence(text) {
  const answerScore = ANSWER_HINTS.filter((term) => text.includes(term)).length;
  const issueScore = ISSUE_HINTS.filter((term) => text.includes(term)).length;
  if (answerScore > issueScore) return "answer";
  if (issueScore > 0) return "issue";
  return "note";
}

function buildIssueTitle(text, fallback, kind) {
  if (kind === "answer") return `${fallback}への回答`;
  const cleaned = text.replace(/^(課題|問題|懸念)(は|として|:|：)?/g, "").trim();
  return trimText(cleaned || fallback, 28);
}

function summarizeIssue(text) {
  return trimText(text.replace(/^(課題|問題|懸念)(は|として|:|：)?/g, "").trim(), 84);
}

function summarizeAnswer(text) {
  return trimText(text.replace(/^(解決策|回答|結論)(として|は|:|：)?/g, "").trim(), 96);
}

function compactLabel(text) {
  return trimText(text.replace(/[。、,.!?！？「」]/g, " ").trim(), 14) || "未分類";
}

function trimText(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function render() {
  const currentTopic = TOPICS.find((topic) => topic.id === state.currentTopicId);
  const latestIssue = state.issues.at(-1);
  els.currentTopic.textContent = currentTopic?.label || latestIssue?.topicLabel || "待機中";
  els.shiftCount.textContent = String(state.shiftCount);
  els.issueCount.textContent = String(state.issues.length);
  els.answeredCount.textContent = String(state.issues.filter((issue) => issue.status === "answered").length);
  els.openCount.textContent = String(state.issues.filter((issue) => issue.status !== "answered").length);
  renderSources();
  renderIssues();
  renderLog();
}

function renderSources() {
  els.sourceList.innerHTML = "";
  if (!state.sources.length) {
    els.sourceList.innerHTML = '<div class="empty">発話ソースはまだありません。</div>';
    return;
  }

  for (const source of state.sources.slice().reverse()) {
    const item = document.createElement("article");
    item.id = `source-${source.label}`;
    item.className = ["source-card", source.shifted ? "shifted" : ""].filter(Boolean).join(" ");
    item.innerHTML = `
      <div class="source-meta">
        <span>${source.label}</span>
        <strong>${source.topicLabel}</strong>
      </div>
      <p>${escapeHtml(source.text)}</p>
    `;
    els.sourceList.appendChild(item);
  }
}

function renderIssues() {
  els.issueBoard.innerHTML = "";
  if (!state.issues.length) {
    els.issueBoard.innerHTML = '<div class="empty">論点はまだありません。</div>';
    return;
  }

  for (const issue of state.issues.slice().reverse()) {
    const card = document.createElement("article");
    const isActive = issue.topicId === state.currentTopicId;
    card.className = ["issue-card", issue.status, isActive ? "active" : ""].filter(Boolean).join(" ");
    card.innerHTML = `
      <div class="issue-top">
        <span class="status ${issue.status}">${issue.status === "answered" ? "回答済み" : "未回答"}</span>
        <span class="topic-pill">${escapeHtml(issue.topicLabel)}</span>
      </div>
      <h3>${escapeHtml(issue.title)}</h3>
      ${issue.issue ? `<p class="issue-text">${escapeHtml(issue.issue)}</p>` : ""}
      ${issue.answer ? `<p class="answer-text">${escapeHtml(issue.answer)}</p>` : ""}
      <div class="source-links">
        ${issue.sources.map((source) => `<button type="button" data-source="${source}">${source}</button>`).join("")}
      </div>
    `;
    card.querySelectorAll("[data-source]").forEach((button) => {
      button.addEventListener("click", () => focusSource(button.dataset.source));
    });
    els.issueBoard.appendChild(card);
  }
}

function focusSource(sourceLabel) {
  const target = document.querySelector(`#source-${sourceLabel}`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("focused");
  window.setTimeout(() => target.classList.remove("focused"), 1500);
}

function buildFinalSummary() {
  const answered = state.issues.filter((issue) => issue.status === "answered");
  const open = state.issues.filter((issue) => issue.status !== "answered");
  els.finalSummary.innerHTML = `
    <div class="summary-group answered">
      <h3>回答済み</h3>
      ${answered.length ? answered.map(summaryRow).join("") : "<p>なし</p>"}
    </div>
    <div class="summary-group open">
      <h3>未回答</h3>
      ${open.length ? open.map(summaryRow).join("") : "<p>なし</p>"}
    </div>
  `;
  render();
}

function summaryRow(issue) {
  const sourceList = [...new Set([...issue.sources, ...(issue.answerSources || [])])].join(", ");
  return `
    <article>
      <strong>${escapeHtml(issue.title)}</strong>
      <span>${escapeHtml(sourceList)}</span>
    </article>
  `;
}

function renderLog() {
  const payload = {
    current_topic: els.currentTopic.textContent,
    topic_shift_count: state.shiftCount,
    sources: state.sources,
    issues: state.issues,
  };
  els.jsonLog.textContent = JSON.stringify(payload, null, 2);
}

function downloadLog() {
  const payload = {
    exported_at: new Date().toISOString(),
    sources: state.sources,
    issues: state.issues,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `discussion-sources-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function playSamples() {
  SAMPLE_LINES.forEach((line, index) => {
    window.setTimeout(() => addSource(line, "sample"), index * 700);
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

init();
