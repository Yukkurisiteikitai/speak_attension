import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import type { IdeaSessionStore } from "../hooks/ideaSessionStore";
import { useIdeaSession } from "../hooks/useIdeaSession";
import { useLlmSettings } from "../hooks/useLlmSettings";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { downloadFile } from "../lib/download";
import { mindmapPositions, radialPositions } from "../utils/ideaLayout";
import {
  buildIdeaSessionExport,
  renderIdeaMarkdown,
  type IdeaDecision,
  type IdeaPhase,
} from "../utils/ideaSession";
import { checkLlmConnection } from "../utils/llmConnection";
import { MapViewportControls } from "./MapViewportControls";

const GROUP_COLORS = ["#116147", "#b76a1f", "#4756a6", "#a64845", "#6c6218", "#2e7d84", "#8a4d8f", "#5a6b3b"];

type IdeaFlowNodeData = {
  label: string;
  kind: "center" | "group" | "keyword";
  mentionCount?: number;
  decision?: IdeaDecision;
  color?: string;
  phase: IdeaPhase;
};

type IdeaFlowNode = Node<IdeaFlowNodeData>;

function IdeaNode({ data }: NodeProps<IdeaFlowNode>) {
  const pickable = data.kind === "keyword" && data.phase === "select";
  const classNames = [
    "idea-node",
    `idea-node-${data.kind}`,
    data.decision ? `is-${data.decision}` : "",
    pickable ? "is-pickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={data.color ? { borderColor: data.color } : undefined}>
      <Handle type="target" position={Position.Top} className="idea-node-handle" />
      <strong>{data.label}</strong>
      {typeof data.mentionCount === "number" && data.mentionCount > 1 ? <span>×{data.mentionCount}</span> : null}
      {data.decision ? <span className="idea-decision-mark">{decisionLabel(data.decision)}</span> : null}
      <Handle type="source" position={Position.Top} className="idea-node-handle" />
    </div>
  );
}

const nodeTypes = { idea: IdeaNode };

function phaseLabel(phase: IdeaPhase): string {
  if (phase === "capture") return "発散中(キーワード収集)";
  if (phase === "grouping") return "グループ化中…";
  return "整理中(採用・保留・却下を選択)";
}

function decisionLabel(decision: IdeaDecision): string {
  if (decision === "adopted") return "採用";
  if (decision === "rejected") return "却下";
  return "保留";
}

export function IdeaModeView({ store }: { store?: IdeaSessionStore }) {
  const idea = useIdeaSession(store);
  const speech = useSpeechRecognition({ onFinalText: (text) => idea.addUtterance(text, "speech") });
  const [manualText, setManualText] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const [llmStatus, setLlmStatus] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);

  const { session } = idea;
  const phase = session.phase;

  const { nodes, edges } = useMemo(() => {
    const flowEdges: Edge[] = [];
    const colorByGroup = new Map(session.groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]));

    if (phase === "select" || phase === "grouping") {
      const layout = mindmapPositions(session.groups, session.keywords, session.title);
      const flowNodes: IdeaFlowNode[] = [
        {
          id: "idea-center",
          type: "idea",
          position: layout.centerPosition,
          data: { label: session.title, kind: "center", phase },
          draggable: false,
        },
      ];
      for (const group of session.groups) {
        const color = colorByGroup.get(group.id);
        flowNodes.push({
          id: group.id,
          type: "idea",
          position: layout.groupPositions.get(group.id) ?? { x: 0, y: 0 },
          data: { label: group.title, kind: "group", color, phase },
        });
        flowEdges.push({
          id: `edge-center-${group.id}`,
          source: "idea-center",
          target: group.id,
          type: "straight",
          style: { stroke: color, strokeWidth: 2 },
        });
      }
      for (const keyword of session.keywords) {
        const color = keyword.groupId ? colorByGroup.get(keyword.groupId) : undefined;
        const layoutPosition = layout.keywordPositions.get(keyword.id);
        flowNodes.push({
          id: keyword.id,
          type: "idea",
          position: layoutPosition ?? { x: 0, y: 0 },
          data: {
            label: keyword.label,
            kind: "keyword",
            mentionCount: keyword.mentionCount,
            decision: keyword.decision,
            color,
            phase,
          },
        });
        if (keyword.groupId) {
          flowEdges.push({
            id: `edge-${keyword.groupId}-${keyword.id}`,
            source: keyword.groupId,
            target: keyword.id,
            type: "straight",
            style: { stroke: color, strokeWidth: 1.4, opacity: 0.7 },
          });
        }
      }
      return { nodes: flowNodes, edges: flowEdges };
    }

    const layout = radialPositions(session.keywords, session.title);
    const flowNodes: IdeaFlowNode[] = [
      {
        id: "idea-center",
        type: "idea",
        position: layout.centerPosition,
        data: { label: session.title, kind: "center", phase },
        draggable: false,
      },
    ];
    for (const keyword of session.keywords) {
      flowNodes.push({
        id: keyword.id,
        type: "idea",
        position: layout.keywordPositions.get(keyword.id) ?? { x: 0, y: 0 },
        data: { label: keyword.label, kind: "keyword", mentionCount: keyword.mentionCount, phase },
      });
      flowEdges.push({
        id: `edge-center-${keyword.id}`,
        source: "idea-center",
        target: keyword.id,
        type: "straight",
        style: { stroke: "rgba(62, 76, 65, 0.25)", strokeWidth: 1 },
      });
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [phase, session.groups, session.keywords, session.title]);

  const handleCheckConnection = async () => {
    setLlmStatus("接続確認中…");
    const result = await checkLlmConnection(llmSettings);
    if (result.autofillModel) updateLlmSettings({ model: result.autofillModel });
    setLlmStatus(result.statusMessage);
  };

  const finishCapture = () => {
    speech.stop();
    void idea.finishCapture({ llmSettings: useLlm ? llmSettings : null });
  };

  const submitManualText = () => {
    const text = manualText.trim();
    if (!text) return;
    idea.addUtterance(text, "manual");
    setManualText("");
  };

  const decisionCounts = useMemo(
    () => ({
      adopted: session.keywords.filter((keyword) => keyword.decision === "adopted").length,
      hold: session.keywords.filter((keyword) => keyword.decision === "hold").length,
      rejected: session.keywords.filter((keyword) => keyword.decision === "rejected").length,
    }),
    [session.keywords],
  );
  const inheritedMeetingItems = useMemo(() => {
    const byId = new Map<string, { id: string; title: string; category: "issue" | "unresolved" }>();
    for (const utterance of session.utterances) {
      for (const reference of utterance.sourceReferences ?? []) {
        if (reference.category !== "issue" && reference.category !== "unresolved") continue;
        byId.set(reference.itemId, { id: reference.itemId, title: reference.itemTitle, category: reference.category });
      }
    }
    return [...byId.values()];
  }, [session.utterances]);
  const utterancesById = useMemo(
    () => new Map(session.utterances.map((utterance) => [utterance.id, utterance])),
    [session.utterances],
  );

  return (
    <section className="dashboard-grid idea-mode" aria-label="idea brainstorm mode">
      <div className="graph-column">
        <section className="graph-panel idea-flow" aria-label="idea map">
          <div className="graph-title">
            <h2>Idea Map</h2>
            <span>{phaseLabel(phase)}</span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            minZoom={0.2}
            maxZoom={1.6}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (phase === "select" && node.data.kind === "keyword") idea.cycleDecision(node.id);
            }}
          >
            <MapViewportControls fitKey={phase} padding={0.15} />
            <Background gap={20} color="#d5ddd8" />
          </ReactFlow>
        </section>
      </div>

      <div className="rail-column">
        <section className="panel" aria-label="idea controls">
          <h2>アイデア出し</h2>
          <p className="idea-phase-note">{phaseLabel(phase)}</p>
          {inheritedMeetingItems.length > 0 ? (
            <div className="idea-meeting-source">
              <strong>会議から引き継いだテーマ</strong>
              <ul>
                {inheritedMeetingItems.map((item) => (
                  <li key={item.id}>{item.category === "issue" ? "課題" : "未解決"}: {item.title}</li>
                ))}
              </ul>
              <small>根拠となる元発言も出典として保持しています。</small>
            </div>
          ) : null}

          {phase === "capture" ? (
            <>
              <div className="button-row">
                <button type="button" onClick={speech.isListening ? speech.stop : speech.start} disabled={!speech.isSupported}>
                  {speech.isListening ? "🎙 停止" : "🎙 音声入力を開始"}
                </button>
                <button type="button" onClick={finishCapture} disabled={session.keywords.length === 0}>
                  出し終わった → グループ分け
                </button>
              </div>
              {speech.error ? <p className="error-text">{speech.error}</p> : null}
              {speech.interimText ? <p className="idea-interim">…{speech.interimText}</p> : null}
              <textarea
                rows={2}
                placeholder="テキストでアイデアを追加(Cmd/Ctrl+Enterで追加)"
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    submitManualText();
                  }
                }}
              />
              <div className="button-row">
                <button type="button" onClick={submitManualText} disabled={!manualText.trim()}>
                  追加
                </button>
                <button type="button" onClick={() => { speech.stop(); idea.reset(); setMarkdown(null); }}>
                  リセット
                </button>
              </div>

              <div className="idea-llm-settings">
                <label>
                  <input type="checkbox" checked={useLlm} onChange={(event) => setUseLlm(event.target.checked)} />
                  グループ分けにローカルLLM(LM Studio)を使う
                </label>
                {useLlm ? (
                  <>
                    <input
                      type="text"
                      value={llmSettings.baseUrl}
                      onChange={(event) => updateLlmSettings({ baseUrl: event.target.value })}
                      placeholder="http://127.0.0.1:1234/v1"
                    />
                    <input
                      type="text"
                      value={llmSettings.model}
                      onChange={(event) => updateLlmSettings({ model: event.target.value })}
                      placeholder="model id(接続確認で自動入力)"
                    />
                    <div className="button-row">
                      <button type="button" onClick={() => void handleCheckConnection()}>
                        接続確認
                      </button>
                    </div>
                    {llmStatus ? <p className="idea-llm-status">{llmStatus}</p> : null}
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          {phase === "grouping" ? <p>キーワードをグループに分けています…</p> : null}

          {phase === "select" ? (
            <>
              {idea.groupingNote ? <p className="idea-llm-status">{idea.groupingNote}</p> : null}
              <p>採用 {decisionCounts.adopted}・保留 {decisionCounts.hold}・却下 {decisionCounts.rejected}</p>
              <p className="idea-phase-note">マップ上ではクリックするたびに「保留 → 採用 → 却下」と切り替わります。</p>
              <div className="idea-group-editor" aria-label="グループ名の編集">
                <strong>グループ名</strong>
                {session.groups.map((group) => (
                  <label key={group.id}>
                    <span>{group.keywordIds.length}件</span>
                    <input
                      aria-label={`${group.title}のグループ名`}
                      defaultValue={group.title}
                      key={`${group.id}-${group.title}`}
                      onBlur={(event) => idea.renameGroup(group.id, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="button-row">
                <button type="button" onClick={() => { idea.resumeCapture(); setMarkdown(null); }}>
                  まだ出す(発散に戻る)
                </button>
                <button type="button" onClick={() => setMarkdown(renderIdeaMarkdown(session))}>
                  結果を出力
                </button>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => downloadFile(`idea-session-${Date.now()}.md`, renderIdeaMarkdown(session), "text/markdown")}
                >
                  Markdown保存
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      `idea-session-${Date.now()}.json`,
                      JSON.stringify(buildIdeaSessionExport(session), null, 2),
                      "application/json",
                    )
                  }
                >
                  セッションJSON保存(RAG用)
                </button>
              </div>
              {markdown ? <textarea rows={14} readOnly value={markdown} /> : null}
            </>
          ) : null}
        </section>

        <section className="panel idea-keyword-list" aria-label="idea keywords">
          <h2>キーワード({session.keywords.length})</h2>
          <ul>
            {[...session.keywords]
              .sort((left, right) => right.firstMentionedAt - left.firstMentionedAt)
              .map((keyword) => {
                const firstUtterance = utterancesById.get(keyword.utteranceIds[0]);
                return (
                  <li key={keyword.id} className={`is-${keyword.decision}`}>
                    <div className="idea-keyword-row">
                      <span className="idea-keyword-chip">
                        {keyword.label}
                        {keyword.mentionCount > 1 ? ` ×${keyword.mentionCount}` : ""}
                      </span>
                      {phase === "select" ? (
                        <div className="idea-decision-buttons" aria-label={`${keyword.label}の状態`}>
                          {(["adopted", "hold", "rejected"] as const).map((decision) => (
                            <button
                              type="button"
                              className={`decision-${decision}`}
                              aria-pressed={keyword.decision === decision}
                              key={decision}
                              onClick={() => idea.setDecision(keyword.id, decision)}
                            >
                              {decisionLabel(decision)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {firstUtterance ? <small>「{firstUtterance.text}」</small> : null}
                  </li>
                );
              })}
          </ul>
          {session.keywords.length === 0 ? <p className="idea-phase-note">話し始めるとキーワードがこことマップに増えていきます。</p> : null}
        </section>
      </div>
    </section>
  );
}
