import { ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { AnalyzedSegment, ConversationTreeState } from "../types/topic";
import { classifyUtterance, semanticRoleLabels, type SemanticRole, type UtteranceClassification } from "../utils/utteranceClassification";
import { SemanticBadge } from "./SemanticBadge";
import { TimelineCorrectionMenu, type SemanticRoleOption } from "./TimelineCorrectionMenu";
import { downloadFile } from "../lib/download";

type ConversationTimelineProps = {
  conversationTree: ConversationTreeState;
  segments: AnalyzedSegment[];
  selectedNodeId: string | null;
  onRate: (nodeId: string) => void;
  onSelect: (nodeId: string | null) => void;
  onStart?: () => void;
};

const ROLE_OPTIONS: SemanticRoleOption[] = (Object.keys(semanticRoleLabels) as SemanticRole[]).map((value) => ({
  value,
  label: semanticRoleLabels[value],
}));

export function ConversationTimeline({
  conversationTree,
  segments,
  selectedNodeId,
  onRate,
  onSelect,
  onStart,
}: ConversationTimelineProps) {
  const segmentById = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);

  const sortedNodes = useMemo(
    () => [...conversationTree.nodes].sort((a, b) => a.createdAt - b.createdAt),
    [conversationTree.nodes]
  );

  // Timeline-only classification (ADR 0021): never feeds the decision graph
  // or Meeting State. A manual correction only overrides semanticRole for
  // display/export -- it does not change how classifyUtterance itself works.
  const classifications = useMemo(
    () => new Map<string, UtteranceClassification>(sortedNodes.map((node) => [node.id, classifyUtterance(node.originalText)])),
    [sortedNodes],
  );
  const [corrections, setCorrections] = useState<Map<string, SemanticRole>>(new Map());
  const setCorrection = (nodeId: string, role: SemanticRole) => setCorrections((current) => {
    const next = new Map(current);
    next.set(nodeId, role);
    return next;
  });

  const exportClassifications = () => {
    const rows = sortedNodes.map((node) => {
      const auto = classifications.get(node.id)!;
      const corrected = corrections.get(node.id) ?? null;
      return {
        nodeId: node.id,
        segmentId: node.segmentId,
        text: node.originalText,
        createdAt: node.createdAt,
        autoClassification: auto,
        correctedSemanticRole: corrected,
        isCorrected: corrected !== null,
      };
    });
    downloadFile(
      "timeline-classification.json",
      JSON.stringify({ format: "timeline-utterance-classification", version: 1, exportedAt: Date.now(), rows }, null, 2),
      "application/json",
    );
  };

  return (
    <section className="conversation-timeline" aria-label="会議の発言タイムライン">
      <div className="graph-title">
        <div>
          <h2>会話のタイムライン</h2>
          <span>発言を時系列で確認できます</span>
        </div>
        {conversationTree.nodes.length > 0 ? (
          <button type="button" className="quiet-button" onClick={exportClassifications}>
            分類をエクスポート
          </button>
        ) : null}
      </div>

      {conversationTree.nodes.length === 0 ? (
        <div className="conversation-empty-state">
          <span className="empty-state-mark" aria-hidden="true">
            ◌
          </span>
          <p className="eyebrow">会話のマップ</p>
          <h3>話し始めると、会議の流れがここに見えてきます</h3>
          <p>
            発言を「話題 → 課題 → 原因 → アクション」に整理し、決まったことや未解決の点をたどれます。
          </p>
          <div className="empty-state-flow">
            <span>話題</span>
            <i>→</i>
            <span>課題</span>
            <i>→</i>
            <span>アクション</span>
          </div>
          {onStart ? (
            <button className="primary-button" type="button" onClick={onStart}>
              会議を始める
            </button>
          ) : null}
        </div>
      ) : null}

      {conversationTree.nodes.length > 0 ? (
        <ol className="timeline-list">
          {sortedNodes.map((node) => {
            const segment = segmentById.get(node.segmentId);
            const speaker = segment?.metadata?.speaker ?? "発言者不明";
            const isSelected = node.id === selectedNodeId;
            const autoClassification = classifications.get(node.id)!;
            const correctedRole = corrections.get(node.id) ?? null;
            const effectiveClassification: UtteranceClassification = correctedRole
              ? { ...autoClassification, semanticRole: correctedRole }
              : autoClassification;

            return (
              <li
                key={node.id}
                className={`timeline-row ${isSelected ? "is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="timeline-row-button"
                  onClick={() => onSelect(isSelected ? null : node.id)}
                >
                  <time>
                    {new Date(node.createdAt).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>

                  <span className="timeline-speaker">{speaker}</span>

                  <SemanticBadge classification={effectiveClassification} />

                  <div className="timeline-text-content">
                    <div className="timeline-label">{node.label}</div>
                    {node.originalText !== node.label ? (
                      <details className="timeline-details">
                        <summary>原文を見る</summary>
                        <p>{node.originalText}</p>
                      </details>
                    ) : null}
                  </div>

                  {node.rating === 1 || node.manuallyAdjusted ? (
                    <span className="timeline-status">
                      {node.rating === 1 ? (
                        <span className="timeline-rating" aria-label="高評価">
                          <ThumbsUp size={14} aria-hidden="true" />
                        </span>
                      ) : null}
                      {node.manuallyAdjusted ? <span className="timeline-manually-adjusted">手動修正</span> : null}
                    </span>
                  ) : null}
                </button>

                <TimelineCorrectionMenu
                  currentValue={effectiveClassification.semanticRole}
                  isCorrected={correctedRole !== null}
                  options={ROLE_OPTIONS}
                  onChange={(value) => setCorrection(node.id, value as SemanticRole)}
                />

                <button
                  type="button"
                  className={`conversation-rating ${node.rating === 1 ? "is-rated" : ""}`}
                  aria-label={`${node.label}を高評価${node.rating === 1 ? "から戻す" : "する"}`}
                  aria-pressed={node.rating === 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRate(node.id);
                  }}
                >
                  <ThumbsUp size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
