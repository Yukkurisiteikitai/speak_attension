import { useState } from "react";
import type { GraphDiffResult } from "../../design-hinge/graph/graphDiff";
import type { HingeEdge, HingeGraph, HingeNode } from "../../design-hinge/graph/types";
import type { InterventionCandidate, InterventionCard } from "../../design-hinge/policy/types";
import type { DesignHingeSessionExport } from "../../design-hinge/events/exportEvents";
import { downloadFile } from "../lib/download";

type DesignHingePanelProps = {
  activeCard: InterventionCard | null;
  graph: HingeGraph;
  pendingProposals: { nodes: HingeNode[]; edges: HingeEdge[] };
  pendingCandidateQueue: InterventionCandidate[];
  policyEnabled: boolean;
  acceptNodeProposal: (nodeId: string) => void;
  acceptEdgeProposal: (edgeId: string) => void;
  rejectEdgeProposal: (edgeId: string) => void;
  approveIntervention: (cardId: string) => void;
  dismissIntervention: (cardId: string, reason: "user" | "timeout" | "superseded") => void;
  createCounterfactual: (target: { nodeId?: string; edgeId?: string }) => GraphDiffResult;
  requestManualIntervention: () => void;
  setPolicyEnabled: (enabled: boolean) => void;
  exportSession: () => DesignHingeSessionExport;
};

const CONFIDENCE_LABELS: Array<[number, string]> = [
  [0.75, "高"],
  [0.4, "中"],
];

function confidenceLabel(confidence: number): string {
  for (const [threshold, label] of CONFIDENCE_LABELS) {
    if (confidence >= threshold) return label;
  }
  return "低";
}

function nodeLabel(graph: HingeGraph, nodeId: string): string {
  return graph.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

// Minimal list UI (no React Flow graph view yet, per the MVP plan): pending
// proposals with accept/reject, the single active card with approve/dismiss +
// reason + confidence badge, and a flat node/edge list. Wired as a third
// meeting-rail tab in App.tsx, dual-fed from the same useSpeechRecognition
// onFinalText callback as the existing meeting engine.
export function DesignHingePanel({
  activeCard,
  graph,
  pendingProposals,
  pendingCandidateQueue,
  policyEnabled,
  acceptNodeProposal,
  acceptEdgeProposal,
  rejectEdgeProposal,
  approveIntervention,
  dismissIntervention,
  createCounterfactual,
  requestManualIntervention,
  setPolicyEnabled,
  exportSession,
}: DesignHingePanelProps) {
  const [counterfactualResult, setCounterfactualResult] = useState<GraphDiffResult | null>(null);

  const handleCounterfactual = (nodeId: string) => {
    setCounterfactualResult(createCounterfactual({ nodeId }));
  };

  const handleExport = () => {
    const exported = exportSession();
    downloadFile(`design-hinge-session-${exported.generatedAt}.json`, JSON.stringify(exported, null, 2), "application/json");
  };

  return (
    <section className="panel design-hinge-panel" aria-label="設計仮説">
      <div className="section-head">
        <h2>設計仮説</h2>
        <span>{policyEnabled ? "介入: 有効" : "介入: 停止中"}</span>
      </div>

      <label className="focus-lock-control">
        <input type="checkbox" checked={policyEnabled} onChange={(event) => setPolicyEnabled(event.currentTarget.checked)} />
        <span>自動介入を有効にする</span>
      </label>
      <div className="report-actions">
        <button type="button" onClick={requestManualIntervention}>
          質問する
        </button>
        <button type="button" onClick={handleExport}>
          書き出す
        </button>
      </div>

      <section>
        <div className="section-head">
          <h2>介入カード</h2>
          <span>{pendingCandidateQueue.length}件 待機中</span>
        </div>
        {activeCard ? (
          <article className="guide-card">
            <strong>
              {activeCard.questionText}
              <span> ({confidenceLabel(activeCard.confidence)})</span>
            </strong>
            <p>{activeCard.reasonSummary}</p>
            <div className="report-actions">
              <button type="button" onClick={() => approveIntervention(activeCard.id)}>
                表示する
              </button>
              <button type="button" onClick={() => dismissIntervention(activeCard.id, "user")}>
                今は不要
              </button>
            </div>
          </article>
        ) : (
          <p className="empty-text">今のところ提案はありません。</p>
        )}
      </section>

      {counterfactualResult ? (
        <section>
          <div className="section-head">
            <h2>反実仮想の結果</h2>
            <span>{counterfactualResult.affectedNodeIds.length}件 影響</span>
          </div>
          <article className="guide-card">
            <p>{counterfactualResult.summary}</p>
          </article>
        </section>
      ) : null}

      <section>
        <div className="section-head">
          <h2>提案中のノード</h2>
          <span>{pendingProposals.nodes.length}件</span>
        </div>
        {pendingProposals.nodes.length ? (
          <div className="guide-list">
            {pendingProposals.nodes.map((node) => (
              <article className="guide-card" key={node.id}>
                <strong>{node.label}</strong>
                <p>{node.type} / 出所: {node.origin}</p>
                <div className="report-actions">
                  <button type="button" onClick={() => acceptNodeProposal(node.id)}>
                    確認済みにする
                  </button>
                  <button type="button" onClick={() => handleCounterfactual(node.id)}>
                    反実仮想
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-text">提案中のノードはありません。</p>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>提案中のエッジ</h2>
          <span>{pendingProposals.edges.length}件</span>
        </div>
        {pendingProposals.edges.length ? (
          <div className="guide-list">
            {pendingProposals.edges.map((edge) => (
              <article className="guide-card" key={edge.id}>
                <strong>
                  {nodeLabel(graph, edge.source)} → {nodeLabel(graph, edge.target)} ({edge.relation})
                </strong>
                <p>確信度: {confidenceLabel(edge.confidence)} / 検証: {edge.testStatus}</p>
                <div className="report-actions">
                  <button type="button" onClick={() => acceptEdgeProposal(edge.id)}>
                    確認済みにする
                  </button>
                  <button type="button" onClick={() => rejectEdgeProposal(edge.id)}>
                    取り消す
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-text">提案中のエッジはありません。</p>
        )}
      </section>

      <details className="dev-drawer">
        <summary>グラフ全体（開発者向け）</summary>
        <section className="dev-section">
          <div className="section-head">
            <h2>ノード</h2>
            <span>{graph.nodes.length}件</span>
          </div>
          <ul>
            {graph.nodes.map((node) => (
              <li key={node.id}>
                {node.label}（{node.type} / {node.origin}）
              </li>
            ))}
          </ul>
        </section>
        <section className="dev-section">
          <div className="section-head">
            <h2>エッジ</h2>
            <span>{graph.edges.length}件</span>
          </div>
          <ul>
            {graph.edges.map((edge) => (
              <li key={edge.id}>
                {nodeLabel(graph, edge.source)} → {nodeLabel(graph, edge.target)}（{edge.relation} / {edge.testStatus}）
              </li>
            ))}
          </ul>
        </section>
      </details>
    </section>
  );
}
