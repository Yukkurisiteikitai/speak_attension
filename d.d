diff --git a/docs/CODE_GUIDE.md b/docs/CODE_GUIDE.md
index 6f01963..8411c47 100644
--- a/docs/CODE_GUIDE.md
+++ b/docs/CODE_GUIDE.md
@@ -61,7 +61,7 @@ speech / manual text / replay
 
 ### `src/utils/ideaSession.ts`
 
-アイデア出しセッションの状態遷移、採用・保留・却下、グループ名編集、キーワードと発話の対応、会議整理からの引継ぎ、Markdown/JSON エクスポート。
+アイデア出しセッションの状態遷移、採用・保留・却下、グループ名編集、キーワードと発話の対応、会議整理からの引継ぎ、表示用の集計セレクター、Markdown/JSON エクスポート。
 
 ### `src/utils/ideaExtraction.ts`
 
@@ -83,6 +83,10 @@ speech / manual text / replay
 
 アイデアマップ、音声・手入力、グループ化、採用選択、エクスポート UI。
 
+### `src/components/ideaFlow.tsx`
+
+アイデアセッションを React Flow のノード・エッジへ変換する表示アダプターと、ノード表示。収集時の放射状マップと整理時の一方向階層を、UI の状態管理から分離する。
+
 ### `src/components/MapViewportControls.tsx`
 
 3種類の React Flow マップで共用するズーム操作と「全体を表示」。`fitKey` が変わる初回・フェーズ切替・再整理時だけ自動で全体表示し、通常のデータ追加ではユーザーの閲覧位置を維持する。
@@ -111,6 +115,10 @@ Topic matching and topic creation rules.
 
 Coverage detection, gap generation, lifecycle derivation, and gap sorting.
 
+### `src/utils/topicProjection.ts`
+
+従来分析用の `MeetingGraph` を表示ノード・エッジへ投影する純粋関数。発言の時系列整理、枝ごとの寸法計算、左右の高さバランス、座標計算、表示要素生成を段階ごとの内部関数に分けている。
+
 ### `src/utils/conversationTree.ts` / `src/utils/conversationTreeLayout.ts`
 
 リアルタイム発言を話題・課題・原因・アクション・別案・通常発言へ分類し、親を追加時に固定する純粋関数。レイアウトは部分木の高さを先に見積もり、任意深度の右向きツリーを重なりなく配置する。
@@ -137,6 +145,8 @@ Diagnostic side panel. It shows current topic, gaps, coverage, latest analysis,
 
 ローカル LLM との通信共通部。`ideaGrouping` と `llmGapReview` から利用する。接続確認は `src/utils/llmConnection.ts` の `checkLlmConnection` を両モードの設定 UI から共用する。
 
+`src/hooks/useLlmConnectionCheck.ts` は接続確認中・成功・失敗の表示状態と、未設定モデルの自動入力を両モードで共通管理する。
+
 ### `src/utils/llmGapReview.ts` / `src/utils/llmTopicTitle.ts` / `src/utils/llmMeetingSynthesis.ts`
 
 会議後レポートのレビュー、トピック名、終了時マップの補助処理。いずれも呼び出し元でルールベースの結果を維持できるようにする。
diff --git a/src/components/IdeaModeView.tsx b/src/components/IdeaModeView.tsx
index 7d9397f..0fd59a5 100644
--- a/src/components/IdeaModeView.tsx
+++ b/src/components/IdeaModeView.tsx
@@ -1,187 +1,51 @@
 import {
   Background,
-  Handle,
-  Position,
   ReactFlow,
-  type Edge,
-  type Node,
-  type NodeProps,
 } from "@xyflow/react";
 import { useMemo, useState } from "react";
 import type { IdeaSessionStore } from "../hooks/ideaSessionStore";
 import { useIdeaSession } from "../hooks/useIdeaSession";
+import { useLlmConnectionCheck } from "../hooks/useLlmConnectionCheck";
 import { useLlmSettings } from "../hooks/useLlmSettings";
 import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
 import { downloadFile } from "../lib/download";
-import { mindmapPositions, radialPositions } from "../utils/ideaLayout";
 import {
   buildIdeaSessionExport,
+  collectIdeaMeetingSourceItems,
+  countIdeaDecisions,
   renderIdeaMarkdown,
-  type IdeaDecision,
   type IdeaPhase,
 } from "../utils/ideaSession";
-import { checkLlmConnection } from "../utils/llmConnection";
 import { ConfirmDialog } from "./ConfirmDialog";
+import { buildIdeaFlowElements, decisionLabel, ideaNodeTypes } from "./ideaFlow";
 import { MapViewportControls } from "./MapViewportControls";
 
-const GROUP_COLORS = ["#116147", "#b76a1f", "#4756a6", "#a64845", "#6c6218", "#2e7d84", "#8a4d8f", "#5a6b3b"];
-
-type IdeaFlowNodeData = {
-  label: string;
-  kind: "center" | "group" | "keyword";
-  mentionCount?: number;
-  decision?: IdeaDecision;
-  color?: string;
-  phase: IdeaPhase;
-};
-
-type IdeaFlowNode = Node<IdeaFlowNodeData>;
-
-function IdeaNode({ data }: NodeProps<IdeaFlowNode>) {
-  const pickable = data.kind === "keyword" && data.phase === "select";
-  const isHierarchy = data.phase === "grouping" || data.phase === "select";
-  const classNames = [
-    "idea-node",
-    `idea-node-${data.kind}`,
-    data.decision ? `is-${data.decision}` : "",
-    pickable ? "is-pickable" : "",
-  ]
-    .filter(Boolean)
-    .join(" ");
-
-  return (
-    <div className={classNames} style={data.color ? { borderColor: data.color } : undefined}>
-      <Handle type="target" position={isHierarchy ? Position.Left : Position.Top} className="idea-node-handle" />
-      <strong>{data.label}</strong>
-      {typeof data.mentionCount === "number" && data.mentionCount > 1 ? <span>×{data.mentionCount}</span> : null}
-      {data.decision ? <span className="idea-decision-mark">{decisionLabel(data.decision)}</span> : null}
-      <Handle type="source" position={isHierarchy ? Position.Right : Position.Top} className="idea-node-handle" />
-    </div>
-  );
-}
-
-const nodeTypes = { idea: IdeaNode };
-
 function phaseLabel(phase: IdeaPhase): string {
   if (phase === "capture") return "発散中(キーワード収集)";
   if (phase === "grouping") return "グループ化中…";
   return "整理中(採用・保留・却下を選択)";
 }
 
-function decisionLabel(decision: IdeaDecision): string {
-  if (decision === "adopted") return "採用";
-  if (decision === "rejected") return "却下";
-  return "保留";
-}
-
 export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
   const idea = useIdeaSession(store);
   const speech = useSpeechRecognition({ onFinalText: (text) => idea.addUtterance(text, "speech") });
   const [manualText, setManualText] = useState("");
   const [useLlm, setUseLlm] = useState(false);
   const { llmSettings, updateLlmSettings } = useLlmSettings();
-  const [llmStatus, setLlmStatus] = useState<string | null>(null);
+  const { connectionStatus: llmStatus, checkConnection: checkLlmConnection } = useLlmConnectionCheck({
+    settings: llmSettings,
+    onUpdateSettings: updateLlmSettings,
+  });
   const [markdown, setMarkdown] = useState<string | null>(null);
   const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
 
   const { session } = idea;
   const phase = session.phase;
 
-  const { nodes, edges } = useMemo(() => {
-    const flowEdges: Edge[] = [];
-    const colorByGroup = new Map(session.groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]));
-
-    if (phase === "select" || phase === "grouping") {
-      const layout = mindmapPositions(session.groups, session.keywords, session.title);
-      const flowNodes: IdeaFlowNode[] = [
-        {
-          id: "idea-center",
-          type: "idea",
-          position: layout.centerPosition,
-          data: { label: session.title, kind: "center", phase },
-          draggable: false,
-        },
-      ];
-      for (const group of session.groups) {
-        const color = colorByGroup.get(group.id);
-        flowNodes.push({
-          id: group.id,
-          type: "idea",
-          position: layout.groupPositions.get(group.id) ?? { x: 0, y: 0 },
-          data: { label: group.title, kind: "group", color, phase },
-        });
-        flowEdges.push({
-          id: `edge-center-${group.id}`,
-          source: "idea-center",
-          target: group.id,
-          type: "straight",
-          style: { stroke: color, strokeWidth: 2 },
-        });
-      }
-      for (const keyword of session.keywords) {
-        const color = keyword.groupId ? colorByGroup.get(keyword.groupId) : undefined;
-        const layoutPosition = layout.keywordPositions.get(keyword.id);
-        flowNodes.push({
-          id: keyword.id,
-          type: "idea",
-          position: layoutPosition ?? { x: 0, y: 0 },
-          data: {
-            label: keyword.label,
-            kind: "keyword",
-            mentionCount: keyword.mentionCount,
-            decision: keyword.decision,
-            color,
-            phase,
-          },
-        });
-        if (keyword.groupId) {
-          flowEdges.push({
-            id: `edge-${keyword.groupId}-${keyword.id}`,
-            source: keyword.groupId,
-            target: keyword.id,
-            type: "straight",
-            style: { stroke: color, strokeWidth: 1.4, opacity: 0.7 },
-          });
-        }
-      }
-      return { nodes: flowNodes, edges: flowEdges };
-    }
-
-    const layout = radialPositions(session.keywords, session.title);
-    const flowNodes: IdeaFlowNode[] = [
-      {
-        id: "idea-center",
-        type: "idea",
-        position: layout.centerPosition,
-        data: { label: session.title, kind: "center", phase },
-        draggable: false,
-      },
-    ];
-    for (const keyword of session.keywords) {
-      flowNodes.push({
-        id: keyword.id,
-        type: "idea",
-        position: layout.keywordPositions.get(keyword.id) ?? { x: 0, y: 0 },
-        data: { label: keyword.label, kind: "keyword", mentionCount: keyword.mentionCount, phase },
-      });
-      flowEdges.push({
-        id: `edge-center-${keyword.id}`,
-        source: "idea-center",
-        target: keyword.id,
-        type: "straight",
-        style: { stroke: "rgba(62, 76, 65, 0.25)", strokeWidth: 1 },
-      });
-    }
-
-    return { nodes: flowNodes, edges: flowEdges };
-  }, [phase, session.groups, session.keywords, session.title]);
-
-  const handleCheckConnection = async () => {
-    setLlmStatus("接続確認中…");
-    const result = await checkLlmConnection(llmSettings);
-    if (result.autofillModel) updateLlmSettings({ model: result.autofillModel });
-    setLlmStatus(result.statusMessage);
-  };
+  const { nodes, edges } = useMemo(
+    () => buildIdeaFlowElements(session),
+    [phase, session.groups, session.keywords, session.title],
+  );
 
   const finishCapture = () => {
     speech.stop();
@@ -196,23 +60,13 @@ export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
   };
 
   const decisionCounts = useMemo(
-    () => ({
-      adopted: session.keywords.filter((keyword) => keyword.decision === "adopted").length,
-      hold: session.keywords.filter((keyword) => keyword.decision === "hold").length,
-      rejected: session.keywords.filter((keyword) => keyword.decision === "rejected").length,
-    }),
+    () => countIdeaDecisions(session.keywords),
     [session.keywords],
   );
-  const inheritedMeetingItems = useMemo(() => {
-    const byId = new Map<string, { id: string; title: string; category: "issue" | "unresolved" }>();
-    for (const utterance of session.utterances) {
-      for (const reference of utterance.sourceReferences ?? []) {
-        if (reference.category !== "issue" && reference.category !== "unresolved") continue;
-        byId.set(reference.itemId, { id: reference.itemId, title: reference.itemTitle, category: reference.category });
-      }
-    }
-    return [...byId.values()];
-  }, [session.utterances]);
+  const inheritedMeetingItems = useMemo(
+    () => collectIdeaMeetingSourceItems(session.utterances),
+    [session.utterances],
+  );
   const utterancesById = useMemo(
     () => new Map(session.utterances.map((utterance) => [utterance.id, utterance])),
     [session.utterances],
@@ -229,7 +83,7 @@ export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
           <ReactFlow
             nodes={nodes}
             edges={edges}
-            nodeTypes={nodeTypes}
+            nodeTypes={ideaNodeTypes}
             minZoom={0.2}
             maxZoom={1.6}
             nodesDraggable={false}
@@ -314,7 +168,7 @@ export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
                       placeholder="model id(接続確認で自動入力)"
                     />
                     <div className="button-row">
-                      <button type="button" onClick={() => void handleCheckConnection()}>
+                      <button type="button" onClick={() => void checkLlmConnection()}>
                         接続確認
                       </button>
                     </div>
diff --git a/src/components/MeetingReportPanel.tsx b/src/components/MeetingReportPanel.tsx
index 3186371..3bb07cf 100644
--- a/src/components/MeetingReportPanel.tsx
+++ b/src/components/MeetingReportPanel.tsx
@@ -1,9 +1,9 @@
 import { useMemo, useState } from "react";
 import { Download, FileText, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
+import { useLlmConnectionCheck } from "../hooks/useLlmConnectionCheck";
 import { downloadFile } from "../lib/download";
 import type { AnalyzedSegment, ConversationTreeState, ImportantMention, MeetingGraph } from "../types/topic";
 import { type LlmSettings } from "../utils/llmClient";
-import { checkLlmConnection } from "../utils/llmConnection";
 import { reviewReportWithLlm } from "../utils/llmGapReview";
 import { buildMeetingReport, renderMeetingReportMarkdown, type MeetingReport, type MeetingReportFinding } from "../utils/meetingReport";
 import { buildEvaluationDataset, summarizeFeedback, type FindingVerdict, type ReportFeedbackMap } from "../utils/reportFeedback";
@@ -93,7 +93,15 @@ function FindingCard({
 export function MeetingReportPanel({ conversationTree, meetingGraph, importantMentions, segmentArchive, llmSettings, onUpdateLlmSettings }: MeetingReportPanelProps) {
   const [report, setReport] = useState<MeetingReport | null>(null);
   const [feedback, setFeedback] = useState<ReportFeedbackMap>({});
-  const [llmStatus, setLlmStatus] = useState<string | null>(null);
+  const {
+    connectionStatus: llmStatus,
+    setConnectionStatus: setLlmStatus,
+    checkConnection: checkLlmConnection,
+  } = useLlmConnectionCheck({
+    settings: llmSettings,
+    onUpdateSettings: onUpdateLlmSettings,
+    pendingMessage: "接続確認中...",
+  });
   const [isReviewing, setIsReviewing] = useState(false);
 
   const summary = useMemo(() => (report ? summarizeFeedback(report.findings, feedback) : null), [feedback, report]);
@@ -116,13 +124,6 @@ export function MeetingReportPanel({ conversationTree, meetingGraph, importantMe
     });
   };
 
-  const handleCheckConnection = async () => {
-    setLlmStatus("接続確認中...");
-    const result = await checkLlmConnection(llmSettings);
-    if (result.autofillModel) onUpdateLlmSettings({ model: result.autofillModel });
-    setLlmStatus(result.statusMessage);
-  };
-
   const runLlmReview = async () => {
     if (!report || isReviewing) return;
     setIsReviewing(true);
@@ -208,7 +209,7 @@ export function MeetingReportPanel({ conversationTree, meetingGraph, importantMe
           onChange={(event) => onUpdateLlmSettings({ model: event.currentTarget.value })}
         />
         <div className="report-actions">
-          <button type="button" onClick={handleCheckConnection}>
+          <button type="button" onClick={() => void checkLlmConnection()}>
             <span>接続確認</span>
           </button>
           <button type="button" onClick={runLlmReview} disabled={!report || isReviewing || !llmSettings.model}>
diff --git a/src/utils/ideaSession.test.ts b/src/utils/ideaSession.test.ts
index 511f9ca..2442cb7 100644
--- a/src/utils/ideaSession.test.ts
+++ b/src/utils/ideaSession.test.ts
@@ -4,6 +4,8 @@ import {
   applyGrouping,
   beginGrouping,
   buildIdeaSessionExport,
+  collectIdeaMeetingSourceItems,
+  countIdeaDecisions,
   createIdeaSessionFromMeetingSelection,
   createInitialIdeaSessionState,
   renameIdeaGroup,
@@ -87,6 +89,11 @@ describe("setKeywordDecision / renderIdeaMarkdown", () => {
     expect(markdown).toContain("## 却下アイデア");
     expect(markdown).toContain("プッシュ通知(言及2回)");
     expect(markdown).toContain("出典: 「プッシュ通知が欲しい」");
+    expect(countIdeaDecisions(state.keywords)).toEqual({
+      adopted: 1,
+      hold: state.keywords.length - 1,
+      rejected: 0,
+    });
   });
 
   it("renames a group without changing its keyword membership", () => {
@@ -147,6 +154,10 @@ describe("createIdeaSessionFromMeetingSelection", () => {
       topicId: "topic-1",
       segmentId: "seg-1",
     });
+    expect(collectIdeaMeetingSourceItems(state.utterances)).toEqual([
+      { id: "item-1", title: "通知に気づけない", category: "issue" },
+      { id: "item-2", title: "通知方法が未決定", category: "unresolved" },
+    ]);
 
     const exported = buildIdeaSessionExport(state, 11_000);
     expect(exported.utterances[0]?.sourceReferences?.[0]?.itemTitle).toBe("通知に気づけない");
diff --git a/src/utils/ideaSession.ts b/src/utils/ideaSession.ts
index dff9683..dd2a0e0 100644
--- a/src/utils/ideaSession.ts
+++ b/src/utils/ideaSession.ts
@@ -47,6 +47,14 @@ export type IdeaGroup = {
 
 export type IdeaGroupingSource = "llm" | "rules";
 
+export type IdeaDecisionCounts = Record<IdeaDecision, number>;
+
+export type IdeaMeetingSourceItem = {
+  id: string;
+  title: string;
+  category: "issue" | "unresolved";
+};
+
 export type IdeaSessionState = {
   phase: IdeaPhase;
   startedAt: number;
@@ -211,6 +219,28 @@ export function renameIdeaGroup(state: IdeaSessionState, groupId: string, title:
   };
 }
 
+export function countIdeaDecisions(keywords: IdeaKeyword[]): IdeaDecisionCounts {
+  return keywords.reduce<IdeaDecisionCounts>(
+    (counts, keyword) => ({ ...counts, [keyword.decision]: counts[keyword.decision] + 1 }),
+    { adopted: 0, hold: 0, rejected: 0 },
+  );
+}
+
+export function collectIdeaMeetingSourceItems(utterances: IdeaUtterance[]): IdeaMeetingSourceItem[] {
+  const itemsById = new Map<string, IdeaMeetingSourceItem>();
+  for (const utterance of utterances) {
+    for (const reference of utterance.sourceReferences ?? []) {
+      if (reference.category !== "issue" && reference.category !== "unresolved") continue;
+      itemsById.set(reference.itemId, {
+        id: reference.itemId,
+        title: reference.itemTitle,
+        category: reference.category,
+      });
+    }
+  }
+  return [...itemsById.values()];
+}
+
 function formatTimestamp(at: number): string {
   return new Date(at).toLocaleString("ja-JP");
 }
@@ -236,15 +266,16 @@ const DECISION_LABELS: Record<IdeaDecision, string> = {
 export function renderIdeaMarkdown(state: IdeaSessionState, generatedAt: number = Date.now()): string {
   const utterancesById = new Map(state.utterances.map((utterance) => [utterance.id, utterance]));
   const keywordsById = new Map(state.keywords.map((keyword) => [keyword.id, keyword]));
+  const decisionCounts = countIdeaDecisions(state.keywords);
   const lines: string[] = [
     `# ${state.title} 結果`,
     "",
     `- 生成日時: ${formatTimestamp(generatedAt)}`,
     `- 発言数: ${state.utterances.length}`,
     `- キーワード数: ${state.keywords.length}`,
-    `- 採用: ${state.keywords.filter((keyword) => keyword.decision === "adopted").length}`,
-    `- 保留: ${state.keywords.filter((keyword) => keyword.decision === "hold").length}`,
-    `- 却下: ${state.keywords.filter((keyword) => keyword.decision === "rejected").length}`,
+    `- 採用: ${decisionCounts.adopted}`,
+    `- 保留: ${decisionCounts.hold}`,
+    `- 却下: ${decisionCounts.rejected}`,
     `- グルーピング: ${state.groupingSource === "llm" ? "ローカルLLM" : state.groupingSource === "rules" ? "ルールベース" : "未実施"}`,
     "",
     "## 採用アイデア",
diff --git a/src/utils/topicProjection.ts b/src/utils/topicProjection.ts
index 1f74f6d..923a6ac 100644
--- a/src/utils/topicProjection.ts
+++ b/src/utils/topicProjection.ts
@@ -4,6 +4,14 @@ import { estimateTextWidth } from "./textMetrics";
 
 const ROOT_TOPIC_ID = "meeting-root";
 const ROOT_TITLE = "Meeting";
+const TOPIC_TITLE_FONT_SIZE = 14;
+const TOPIC_META_FONT_SIZE = 12;
+const TOPIC_CONTENT_WIDTH = 234;
+const TOPIC_LIFECYCLE_HEIGHT = 35;
+const TOPIC_BADGE_HEIGHT = 24;
+const TOPIC_PADDING_BORDER = 26;
+const TOPIC_TITLE_LINE_HEIGHT = 22;
+const TOPIC_META_LINE_HEIGHT = 20;
 
 export function createId(prefix: string): string {
   if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
@@ -54,36 +62,25 @@ export function estimateTopicNodeHeight(data: GraphTopicNodeData): number {
     return 48 + lineCount * 19;
   }
 
-  const TITLE_FONT_SIZE = 14;
-  const META_FONT_SIZE = 12;
-  const CONTENT_WIDTH = 234; // approximate px
-  const LIFECYCLE_HEIGHT = 35;
-  const BADGE_HEIGHT = 24;
-  const PADDING_BORDER = 26; // top + bottom padding + border
-
-  // Conservative line heights (slightly over-estimated for safety)
-  const TITLE_LINE_HEIGHT = 22;
-  const META_LINE_HEIGHT = 20;
-
-  const titleLines = Math.ceil(estimateTextWidth(data.label, TITLE_FONT_SIZE) / CONTENT_WIDTH);
-  const titleHeight = titleLines * TITLE_LINE_HEIGHT;
+  const titleLines = Math.ceil(estimateTextWidth(data.label, TOPIC_TITLE_FONT_SIZE) / TOPIC_CONTENT_WIDTH);
+  const titleHeight = titleLines * TOPIC_TITLE_LINE_HEIGHT;
 
   let contentHeight = titleHeight + 8; // gap after title
 
   if (data.evidence) {
-    const metaLines = Math.ceil(estimateTextWidth(data.evidence, META_FONT_SIZE) / CONTENT_WIDTH);
-    contentHeight += metaLines * META_LINE_HEIGHT + 8;
+    const metaLines = Math.ceil(estimateTextWidth(data.evidence, TOPIC_META_FONT_SIZE) / TOPIC_CONTENT_WIDTH);
+    contentHeight += metaLines * TOPIC_META_LINE_HEIGHT + 8;
   }
 
   if (data.lifecycle) {
-    contentHeight += LIFECYCLE_HEIGHT + 8;
+    contentHeight += TOPIC_LIFECYCLE_HEIGHT + 8;
   }
 
   if (data.states && data.states.length > 0) {
-    contentHeight += BADGE_HEIGHT;
+    contentHeight += TOPIC_BADGE_HEIGHT;
   }
 
-  const totalHeight = Math.max(120, contentHeight + PADDING_BORDER);
+  const totalHeight = Math.max(120, contentHeight + TOPIC_PADDING_BORDER);
   return Math.ceil(totalHeight * 1.2); // Extra 20% buffer for CSS rendering variations
 }
 
@@ -111,6 +108,16 @@ type ProjectedTopicBranch = {
   side: BranchSide;
 };
 
+type TopicProjectionInput = {
+  graph: MeetingGraph;
+  currentTopicId: string | null;
+  evidenceByTopicId: Map<string, string>;
+  segments?: AnalyzedSegment[];
+  collapsedTopicIds?: ReadonlySet<string>;
+};
+
+type SideHeights = Record<BranchSide, number>;
+
 function sourceLabel(source: AnalyzedSegment["source"]): string {
   if (source === "speech") return "音声";
   if (source === "replay") return "リプレイ";
@@ -138,158 +145,204 @@ function segmentsByTopicId(segments: AnalyzedSegment[]): Map<string, AnalyzedSeg
   return grouped;
 }
 
-export function projectGraphToFlow(input: {
-  graph: MeetingGraph;
-  currentTopicId: string | null;
-  evidenceByTopicId: Map<string, string>;
-  segments?: AnalyzedSegment[];
-  collapsedTopicIds?: ReadonlySet<string>;
-}): { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] } {
-  const topicNodes = input.graph.nodes.filter((node) => node.id !== input.graph.rootTopicId);
-  const topicSegments = segmentsByTopicId(input.segments ?? []);
-  const collapsedTopicIds = input.collapsedTopicIds ?? new Set<string>();
-
-  const rootNode: TopicGraphNode = {
-    id: input.graph.rootTopicId,
+function createRootFlowNode(graph: MeetingGraph): TopicGraphNode {
+  return {
+    id: graph.rootTopicId,
     type: "topic",
     position: { x: ROOT_X, y: INITIAL_Y },
     data: {
-      label: input.graph.title,
+      label: graph.title,
       kind: "root",
       states: ["discussed"],
       detail: "meeting root",
       isActive: false,
     } satisfies GraphTopicNodeData,
   };
+}
 
-  const flowNodes: TopicGraphNode[] = [rootNode];
-  const flowEdges: TopicGraphEdge[] = [];
-  const branches: ProjectedTopicBranch[] = topicNodes.map((node) => {
-    const branchSegments = topicSegments.get(node.id) ?? [];
-    const isCollapsed = collapsedTopicIds.has(node.id);
-    const visibleSegments = isCollapsed ? [] : branchSegments;
-    const topicData: GraphTopicNodeData = {
-      label: node.title,
-      kind: "topic",
-      states: node.displayStates,
-      lifecycle: node.lifecycle,
-      mentionCount: node.mentionCount,
-      evidence: input.evidenceByTopicId.get(node.id),
-      isActive: node.id === input.currentTopicId,
-      topicId: node.id,
-      childCount: branchSegments.length,
-      isCollapsed,
-    };
-    const topicHeight = estimateTopicNodeHeight(topicData);
-    const utteranceHeights = visibleSegments.map((segment) =>
-      estimateTopicNodeHeight({ label: summarizeTranscriptForMindmap(segment.text), kind: "utterance", states: [] }),
-    );
-    const utteranceBlockHeight = utteranceHeights.reduce((sum, height, index) => sum + height + (index ? UTTERANCE_GAP : 0), 0);
-    const branchHeight = Math.max(topicHeight, utteranceBlockHeight);
-
-    return {
-      node,
-      topicData,
-      topicHeight,
-      visibleSegments,
-      utteranceHeights,
-      utteranceBlockHeight,
-      branchHeight,
-      side: "right",
-    };
-  });
+function buildTopicBranches(
+  input: TopicProjectionInput,
+  topicSegments: Map<string, AnalyzedSegment[]>,
+  collapsedTopicIds: ReadonlySet<string>,
+): ProjectedTopicBranch[] {
+  return input.graph.nodes
+    .filter((node) => node.id !== input.graph.rootTopicId)
+    .map((node) => {
+      const branchSegments = topicSegments.get(node.id) ?? [];
+      const isCollapsed = collapsedTopicIds.has(node.id);
+      const visibleSegments = isCollapsed ? [] : branchSegments;
+      const topicData: GraphTopicNodeData = {
+        label: node.title,
+        kind: "topic",
+        states: node.displayStates,
+        lifecycle: node.lifecycle,
+        mentionCount: node.mentionCount,
+        evidence: input.evidenceByTopicId.get(node.id),
+        isActive: node.id === input.currentTopicId,
+        topicId: node.id,
+        childCount: branchSegments.length,
+        isCollapsed,
+      };
+      const topicHeight = estimateTopicNodeHeight(topicData);
+      const utteranceHeights = visibleSegments.map((segment) =>
+        estimateTopicNodeHeight({
+          label: summarizeTranscriptForMindmap(segment.text),
+          kind: "utterance",
+          states: [],
+        }),
+      );
+      const utteranceBlockHeight = utteranceHeights.reduce(
+        (sum, height, index) => sum + height + (index ? UTTERANCE_GAP : 0),
+        0,
+      );
+      const branchHeight = Math.max(topicHeight, utteranceBlockHeight);
+
+      return {
+        node,
+        topicData,
+        topicHeight,
+        visibleSegments,
+        utteranceHeights,
+        utteranceBlockHeight,
+        branchHeight,
+        side: "right",
+      };
+    });
+}
 
-  const sideHeights: Record<BranchSide, number> = { left: 0, right: 0 };
-  for (const branch of branches) {
+function balanceTopicBranches(
+  branches: ProjectedTopicBranch[],
+): { branches: ProjectedTopicBranch[]; sideHeights: SideHeights } {
+  const sideHeights: SideHeights = { left: 0, right: 0 };
+  const balancedBranches = branches.map((branch) => {
     const side: BranchSide = sideHeights.right <= sideHeights.left ? "right" : "left";
-    branch.side = side;
     sideHeights[side] += (sideHeights[side] > 0 ? BRANCH_GAP : 0) + branch.branchHeight;
-  }
+    return { ...branch, side };
+  });
+
+  return { branches: balancedBranches, sideHeights };
+}
+
+function branchXPositions(side: BranchSide): { topicX: number; utteranceX: number } {
+  const topicX = side === "right"
+    ? ROOT_X + ROOT_WIDTH + ROOT_TO_TOPIC_GAP
+    : ROOT_X - ROOT_TO_TOPIC_GAP - TOPIC_WIDTH;
+  const utteranceX = side === "right"
+    ? topicX + TOPIC_WIDTH + TOPIC_TO_UTTERANCE_GAP
+    : topicX - TOPIC_TO_UTTERANCE_GAP - UTTERANCE_WIDTH;
+  return { topicX, utteranceX };
+}
+
+function projectTopicBranch(
+  rootTopicId: string,
+  branch: ProjectedTopicBranch,
+  cursorY: number,
+): { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] } {
+  const {
+    node,
+    topicData,
+    topicHeight,
+    visibleSegments,
+    utteranceHeights,
+    utteranceBlockHeight,
+    branchHeight,
+    side,
+  } = branch;
+  const topicY = cursorY + (branchHeight - topicHeight) / 2;
+  const utteranceStartY = cursorY + (branchHeight - utteranceBlockHeight) / 2;
+  const { topicX, utteranceX } = branchXPositions(side);
+  const nodes: TopicGraphNode[] = [
+    {
+      id: node.id,
+      type: "topic",
+      position: { x: topicX, y: topicY },
+      data: { ...topicData, branchSide: side },
+      draggable: false,
+    },
+  ];
+  const edges: TopicGraphEdge[] = [
+    {
+      id: `${rootTopicId}-parent-${node.id}`,
+      source: rootTopicId,
+      sourceHandle: `parent-${side}`,
+      target: node.id,
+      targetHandle: "parent",
+      type: "smoothstep",
+      data: { relation: "parent" },
+    },
+  ];
+
+  let utteranceY = utteranceStartY;
+  visibleSegments.forEach((segment, index) => {
+    const utteranceNodeId = `utterance-${node.id}-${segment.id}`;
+    nodes.push({
+      id: utteranceNodeId,
+      type: "topic",
+      position: { x: utteranceX, y: utteranceY },
+      data: {
+        label: summarizeTranscriptForMindmap(segment.text),
+        kind: "utterance",
+        states: [],
+        sequence: index + 1,
+        sourceLabel: sourceLabel(segment.source),
+        topicId: node.id,
+        branchSide: side,
+      },
+      draggable: false,
+    });
+    edges.push({
+      id: `${node.id}-utterance-${segment.id}`,
+      source: node.id,
+      sourceHandle: "utterances",
+      target: utteranceNodeId,
+      targetHandle: "parent",
+      type: "smoothstep",
+      data: { relation: "utterance" },
+    });
+    utteranceY += utteranceHeights[index] + UTTERANCE_GAP;
+  });
+
+  return { nodes, edges };
+}
+
+function projectExtraEdges(graph: MeetingGraph): TopicGraphEdge[] {
+  return graph.edges
+    .filter((edge) => edge.type !== "parent")
+    .map((edge) => ({
+      id: edge.id,
+      source: edge.source,
+      target: edge.target,
+      type: "smoothstep",
+      data: { relation: edge.type },
+    }));
+}
+
+export function projectGraphToFlow(input: TopicProjectionInput): { nodes: TopicGraphNode[]; edges: TopicGraphEdge[] } {
+  const topicSegments = segmentsByTopicId(input.segments ?? []);
+  const collapsedTopicIds = input.collapsedTopicIds ?? new Set<string>();
+  const rootNode = createRootFlowNode(input.graph);
+  const initialBranches = buildTopicBranches(input, topicSegments, collapsedTopicIds);
+  const { branches, sideHeights } = balanceTopicBranches(initialBranches);
 
   const mapHeight = Math.max(ROOT_HEIGHT, sideHeights.left, sideHeights.right);
   const centerY = INITIAL_Y + mapHeight / 2;
   rootNode.position.y = centerY - ROOT_HEIGHT / 2;
+  const flowNodes: TopicGraphNode[] = [rootNode];
+  const flowEdges: TopicGraphEdge[] = [];
 
   for (const side of ["left", "right"] as const) {
     const sideBranches = branches.filter((branch) => branch.side === side);
     let cursorY = centerY - sideHeights[side] / 2;
 
     for (const branch of sideBranches) {
-      const { node, topicData, topicHeight, visibleSegments, utteranceHeights, utteranceBlockHeight, branchHeight } = branch;
-      const topicY = cursorY + (branchHeight - topicHeight) / 2;
-      const utteranceStartY = cursorY + (branchHeight - utteranceBlockHeight) / 2;
-      const topicX = side === "right"
-        ? ROOT_X + ROOT_WIDTH + ROOT_TO_TOPIC_GAP
-        : ROOT_X - ROOT_TO_TOPIC_GAP - TOPIC_WIDTH;
-      const utteranceX = side === "right"
-        ? topicX + TOPIC_WIDTH + TOPIC_TO_UTTERANCE_GAP
-        : topicX - TOPIC_TO_UTTERANCE_GAP - UTTERANCE_WIDTH;
-
-      topicData.branchSide = side;
-      flowNodes.push({
-        id: node.id,
-        type: "topic",
-        position: { x: topicX, y: topicY },
-        data: topicData,
-        draggable: false,
-      });
-      flowEdges.push({
-        id: `${input.graph.rootTopicId}-parent-${node.id}`,
-        source: input.graph.rootTopicId,
-        sourceHandle: `parent-${side}`,
-        target: node.id,
-        targetHandle: "parent",
-        type: "smoothstep",
-        data: { relation: "parent" },
-      });
-
-      let utteranceY = utteranceStartY;
-      visibleSegments.forEach((segment, index) => {
-        const label = summarizeTranscriptForMindmap(segment.text);
-        const utteranceHeight = utteranceHeights[index];
-        const utteranceNodeId = `utterance-${node.id}-${segment.id}`;
-        flowNodes.push({
-          id: utteranceNodeId,
-          type: "topic",
-          position: { x: utteranceX, y: utteranceY },
-          data: {
-            label,
-            kind: "utterance",
-            states: [],
-            sequence: index + 1,
-            sourceLabel: sourceLabel(segment.source),
-            topicId: node.id,
-            branchSide: side,
-          },
-          draggable: false,
-        });
-        flowEdges.push({
-          id: `${node.id}-utterance-${segment.id}`,
-          source: node.id,
-          sourceHandle: "utterances",
-          target: utteranceNodeId,
-          targetHandle: "parent",
-          type: "smoothstep",
-          data: { relation: "utterance" },
-        });
-        utteranceY += utteranceHeight + UTTERANCE_GAP;
-      });
-      cursorY += branchHeight + BRANCH_GAP;
+      const projected = projectTopicBranch(input.graph.rootTopicId, branch, cursorY);
+      flowNodes.push(...projected.nodes);
+      flowEdges.push(...projected.edges);
+      cursorY += branch.branchHeight + BRANCH_GAP;
     }
   }
 
-  // Extra relations are preserved when the engine explicitly has evidence for them.
-  input.graph.edges
-    .filter((edge) => edge.type !== "parent")
-    .forEach((edge) => {
-      flowEdges.push({
-        id: edge.id,
-        source: edge.source,
-        target: edge.target,
-        type: "smoothstep",
-        data: { relation: edge.type },
-      });
-    });
+  flowEdges.push(...projectExtraEdges(input.graph));
 
   return { nodes: flowNodes, edges: flowEdges };
 }
