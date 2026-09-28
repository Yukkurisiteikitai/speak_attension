import { ThumbsUp } from "lucide-react";
import { useMemo } from "react";
import type { ConversationTreeState } from "../types/topic";
import type { SemanticAxes, Scope, SemanticRole } from "../semantic/types";
import type { TimelineRow } from "../semantic/timelineProjection";
import { roleLabels, scopeLabels } from "../semantic/labels";
import { SemanticBadge } from "./SemanticBadge";
import { TimelineCorrectionMenu, type CorrectionAxisOption } from "./TimelineCorrectionMenu";
import { downloadFile } from "../lib/download";

type ConversationTimelineProps = {
  // A projection of semantic state (ADR 0022 §8). This component performs no
  // classification of its own -- that was the defect Phase 2 removed.
  rows: TimelineRow[];
  // Still legacy-owned: ratings and manual parent edits hang off conversation
  // tree nodes. Used only to map a row back to its node id for those controls;
  // Phase 4 moves them onto the semantic layer.
  conversationTree: ConversationTreeState;
  selectedNodeId: string | null;
  onRate: (nodeId: string) => void;
  onSelect: (nodeId: string | null) => void;
  onCorrect: (target: { utteranceId: string; unitId?: string }, axes: Partial<SemanticAxes>) => void;
  onStart?: () => void;
};

const ROLE_OPTIONS: CorrectionAxisOption[] = (Object.keys(roleLabels) as SemanticRole[]).map((value) => ({
  value,
  label: roleLabels[value],
}));

const SCOPE_OPTIONS: CorrectionAxisOption[] = (Object.keys(scopeLabels) as Scope[]).map((value) => ({
  value,
  label: scopeLabels[value],
}));

export function ConversationTimeline({
  rows,
  conversationTree,
  selectedNodeId,
  onRate,
  onSelect,
  onCorrect,
  onStart,
}: ConversationTimelineProps) {
  // Ratings/manual-adjust live on tree nodes keyed by segment id, and the
  // semantic layer uses that same id as the utterance id.
  const nodeByUtteranceId = useMemo(
    () => new Map(conversationTree.nodes.map((node) => [node.segmentId, node])),
    [conversationTree.nodes],
  );

  const exportClassifications = () => {
    downloadFile(
      "timeline-classification.json",
      JSON.stringify({
        format: "timeline-semantic-projection",
        version: 2,
        exportedAt: Date.now(),
        rows: rows.map((row) => ({
          utteranceId: row.utteranceId,
          seq: row.seq,
          createdAt: row.createdAt,
          speaker: row.speaker,
          provider: row.provider,
          text: row.text,
          isCorrected: row.isCorrected,
          units: row.units.map((unit) => ({
            unitId: unit.unitId,
            text: unit.text,
            axes: unit.axes,
            humanOverriddenAxes: unit.humanOverriddenAxes,
            conflictingAxes: unit.conflictingAxes,
            promotion: unit.promotion,
          })),
        })),
      }, null, 2),
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
        {rows.length > 0 ? (
          <button type="button" className="quiet-button" onClick={exportClassifications}>
            分類をエクスポート
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="conversation-empty-state">
          <span className="empty-state-mark" aria-hidden="true">◌</span>
          <p className="eyebrow">会話のマップ</p>
          <h3>話し始めると、会議の流れがここに見えてきます</h3>
          <p>発言を「話題 → 課題 → 原因 → アクション」に整理し、決まったことや未解決の点をたどれます。</p>
          <div className="empty-state-flow">
            <span>話題</span><i>→</i><span>課題</span><i>→</i><span>アクション</span>
          </div>
          {onStart ? (
            <button className="primary-button" type="button" onClick={onStart}>会議を始める</button>
          ) : null}
        </div>
      ) : (
        <ol className="timeline-list">
          {rows.map((row) => {
            const node = nodeByUtteranceId.get(row.utteranceId);
            const isSelected = node ? node.id === selectedNodeId : false;

            return (
              <li key={row.utteranceId} className={`timeline-row ${isSelected ? "is-selected" : ""}`}>
                <div className="timeline-row-main">
                  {/* The row header is the only clickable summary. The per-unit
                      controls below are siblings, never children, of this button:
                      a <select> inside a <button> is invalid HTML and its
                      interaction is unreliable. */}
                  <button
                    type="button"
                    className="timeline-row-button"
                    onClick={() => (node ? onSelect(isSelected ? null : node.id) : undefined)}
                  >
                    <time>
                      {new Date(row.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <span className="timeline-speaker">{row.speaker ?? "発言者不明"}</span>
                    <span className="timeline-text-content">
                      <span className="timeline-label">{row.text}</span>
                    </span>
                    {node?.rating === 1 || row.isCorrected ? (
                      <span className="timeline-status">
                        {node?.rating === 1 ? (
                          <span className="timeline-rating" aria-label="高評価">
                            <ThumbsUp size={14} aria-hidden="true" />
                          </span>
                        ) : null}
                        {row.isCorrected ? <span className="timeline-manually-adjusted">手動修正</span> : null}
                      </span>
                    ) : null}
                  </button>

                  {/* One utterance can carry several meanings, so each unit is
                      listed separately instead of forcing a single label. */}
                  {row.units.length > 0 ? (
                    <ul className="timeline-units">
                      {row.units.map((unit) => (
                        <li className="timeline-unit" key={unit.unitId}>
                          <SemanticBadge unit={unit} />
                          <span className="timeline-unit-text">{unit.text}</span>
                          <TimelineCorrectionMenu
                            axisLabel="意味"
                            currentValue={unit.axes.role}
                            isCorrected={unit.humanOverriddenAxes.includes("role")}
                            options={ROLE_OPTIONS}
                            onChange={(value) => onCorrect(
                              { utteranceId: row.utteranceId, unitId: unit.unitId },
                              { role: value as SemanticRole },
                            )}
                          />
                          <TimelineCorrectionMenu
                            axisLabel="範囲"
                            currentValue={unit.axes.scope}
                            isCorrected={unit.humanOverriddenAxes.includes("scope")}
                            options={SCOPE_OPTIONS}
                            onChange={(value) => onCorrect(
                              { utteranceId: row.utteranceId, unitId: unit.unitId },
                              { scope: value as Scope },
                            )}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {node ? (
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
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
