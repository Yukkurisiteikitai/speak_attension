import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { useIdeaSession } from "../hooks/useIdeaSession";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { mindmapPositions, radialPositions } from "../utils/ideaLayout";
import { buildIdeaSessionExport, renderIdeaMarkdown, type IdeaPhase } from "../utils/ideaSession";
import { DEFAULT_LLM_SETTINGS, fetchModelIds, type LlmSettings } from "../utils/llmClient";

const GROUP_COLORS = ["#116147", "#b76a1f", "#4756a6", "#a64845", "#6c6218", "#2e7d84", "#8a4d8f", "#5a6b3b"];

type IdeaFlowNodeData = {
  label: string;
  kind: "center" | "group" | "keyword";
  mentionCount?: number;
  picked?: boolean;
  color?: string;
  phase: IdeaPhase;
};

type IdeaFlowNode = Node<IdeaFlowNodeData>;

function IdeaNode({ data }: NodeProps<IdeaFlowNode>) {
  const pickable = data.kind === "keyword" && data.phase === "select";
  const classNames = [
    "idea-node",
    `idea-node-${data.kind}`,
    data.picked ? "is-picked" : "",
    pickable ? "is-pickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={data.color ? { borderColor: data.color } : undefined}>
      <Handle type="target" position={Position.Top} className="idea-node-handle" />
      <strong>{data.label}</strong>
      {typeof data.mentionCount === "number" && data.mentionCount > 1 ? <span>×{data.mentionCount}</span> : null}
      {data.picked ? <span className="idea-pick-mark">採用</span> : null}
      <Handle type="source" position={Position.Top} className="idea-node-handle" />
    </div>
  );
}

const nodeTypes = { idea: IdeaNode };

// Re-fits the viewport with an animated transition whenever the phase flips,
// so the radial→mindmap node movement and the camera move together.
function FitOnPhaseChange({ phase }: { phase: IdeaPhase }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ duration: 700, padding: 0.15 });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [fitView, phase]);
  return null;
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function phaseLabel(phase: IdeaPhase): string {
  if (phase === "capture") return "発散中(キーワード収集)";
  if (phase === "grouping") return "グループ化中…";
  return "選択中(採用する要素をクリック)";
}

export function IdeaModeView() {
  const idea = useIdeaSession();
  const speech = useSpeechRecognition({ onFinalText: (text) => idea.addUtterance(text, "speech") });
  const [manualText, setManualText] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS);
  const [llmStatus, setLlmStatus] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);

  const { session } = idea;
  const phase = session.phase;

  const { nodes, edges } = useMemo(() => {
    const flowNodes: IdeaFlowNode[] = [
      {
        id: "idea-center",
        type: "idea",
        position: { x: 0, y: 0 },
        data: { label: session.title, kind: "center", phase },
        draggable: false,
      },
    ];
    const flowEdges: Edge[] = [];
    const colorByGroup = new Map(session.groups.map((group, index) => [group.id, GROUP_COLORS[index % GROUP_COLORS.length]]));

    if (phase === "select" || phase === "grouping") {
      const layout = mindmapPositions(session.groups);
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
          data: { label: keyword.label, kind: "keyword", mentionCount: keyword.mentionCount, picked: keyword.picked, color, phase },
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
    } else {
      const positions = radialPositions(session.keywords);
      for (const keyword of session.keywords) {
        flowNodes.push({
          id: keyword.id,
          type: "idea",
          position: positions.get(keyword.id) ?? { x: 0, y: 0 },
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
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [phase, session.groups, session.keywords, session.title]);

  const checkLlmConnection = async () => {
    setLlmStatus("接続確認中…");
    try {
      const models = await fetchModelIds(llmSettings);
      if (models.length === 0) {
        setLlmStatus("接続はできましたが、ロード済みモデルがありません。");
        return;
      }
      setLlmSettings((current) => ({ ...current, model: current.model || models[0] }));
      setLlmStatus(`接続OK: ${models[0]}`);
    } catch (error) {
      setLlmStatus(error instanceof Error ? error.message : String(error));
    }
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

  const pickedCount = session.keywords.filter((keyword) => keyword.picked).length;
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
            fitView
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (phase === "select" && node.data.kind === "keyword") idea.togglePick(node.id);
            }}
          >
            <FitOnPhaseChange phase={phase} />
            <Background gap={20} color="#d5ddd8" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>
      </div>

      <div className="rail-column">
        <section className="panel" aria-label="idea controls">
          <h2>アイデア出し</h2>
          <p className="idea-phase-note">{phaseLabel(phase)}</p>

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
                      onChange={(event) => setLlmSettings((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder="http://127.0.0.1:1234/v1"
                    />
                    <input
                      type="text"
                      value={llmSettings.model}
                      onChange={(event) => setLlmSettings((current) => ({ ...current, model: event.target.value }))}
                      placeholder="model id(接続確認で自動入力)"
                    />
                    <div className="button-row">
                      <button type="button" onClick={() => void checkLlmConnection()}>
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
              <p>
                採用 {pickedCount} / {session.keywords.length} 件(マップ上のキーワードをクリックで切替)
              </p>
              <div className="button-row">
                <button type="button" onClick={() => { idea.resumeCapture(); setMarkdown(null); }}>
                  まだ出す(発散に戻る)
                </button>
                <button type="button" onClick={() => setMarkdown(renderIdeaMarkdown(session))} disabled={pickedCount === 0}>
                  結果を出力
                </button>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => downloadFile(`idea-session-${Date.now()}.md`, renderIdeaMarkdown(session), "text/markdown")}
                  disabled={pickedCount === 0}
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
                  <li key={keyword.id} className={keyword.picked ? "is-picked" : ""}>
                    <button
                      type="button"
                      className="idea-keyword-chip"
                      onClick={() => idea.togglePick(keyword.id)}
                      disabled={phase !== "select"}
                    >
                      {keyword.label}
                      {keyword.mentionCount > 1 ? ` ×${keyword.mentionCount}` : ""}
                    </button>
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
