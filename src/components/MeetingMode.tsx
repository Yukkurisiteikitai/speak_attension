import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ActionView } from "./ActionView";
import { ConversationNodeEditor } from "./ConversationNodeEditor";
import { ControlPanel } from "./ControlPanel";
import { DesignHingePanel } from "./DesignHingePanel";
import { ManualReplayPanel } from "./ManualReplayPanel";
import { MeetingReportPanel } from "./MeetingReportPanel";
import { MeetingReviewQueue } from "./MeetingReviewQueue";
import type { MeetingArchiveSummary } from "../semantic/meetingArchiveStorage";
import { MeetingSummaryGraph } from "./MeetingSummaryGraph";
import { MeetingStateMap } from "./MeetingStateMap";
import { MeetingStateDashboard } from "./MeetingStateDashboard";
import { MeetingProgressMap } from "./MeetingProgressMap";
import { DecisionSupportPanel } from "./DecisionSupportPanel";
import { ConversationView } from "./ConversationView";
import { TopicInspector } from "./TopicInspector";
import { TranscriptPanel } from "./TranscriptPanel";
import { TranscriptReplayPanel } from "./TranscriptReplayPanel";
import { useDesignHingeStore } from "../hooks/useDesignHingeStore";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useLlmSettings } from "../hooks/useLlmSettings";
import { useTopicEngine } from "../hooks/useTopicEngine";
import { selectDecisionParents } from "../utils/meetingDecisionGraph";
import { buildMeetingStateDashboard } from "../utils/meetingStateDashboard";
import { buildCurrentDiscussionState } from "../utils/currentDiscussionState";
import { formatReplayTime } from "../utils/transcriptReplay";
import type { AnalyzedSegment, MeetingSummary } from "../types/topic";

type MeetingInputTab = "manual" | "replay" | "transcript";
type MeetingMapMode = "dashboard" | "progress" | "state" | "live" | "summary";

function statusLabel(isSupported: boolean, isListening: boolean): string {
  if (!isSupported) return "音声入力は非対応";
  if (isListening) return "音声入力中";
  return "音声入力 待機中";
}

export function MeetingMode({
  active,
  onStartIdeaSession,
}: {
  active: boolean;
  onStartIdeaSession: (summary: MeetingSummary, segments: AnalyzedSegment[], selectedItemIds: string[]) => void;
}) {
  const { llmSettings, updateLlmSettings } = useLlmSettings();
  const topicEngine = useTopicEngine({ llmSettings });
  const designHinge = useDesignHingeStore({ llmSettings });
  const speech = useSpeechRecognition({
    onFinalText: (text) => {
      topicEngine.addTranscriptText(text);
      designHinge.ingestUtterance(text, "speech");
    },
  });
  const [now, setNow] = useState(() => Date.now());
  const [mapMode, setMapMode] = useState<MeetingMapMode>("dashboard");
  const [savedMeetings, setSavedMeetings] = useState<MeetingArchiveSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty" | "failed" | "disabled">("disabled");
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedSegmentCount = useRef(0);
  const [endedView, setEndedView] = useState<"minutes" | "timeline">("minutes");
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const dashboard = useMemo(
    () => buildMeetingStateDashboard(topicEngine.meetingStateGraph, topicEngine.decisionSupport.materials, topicEngine.currentTopic?.title ?? null),
    [topicEngine.meetingStateGraph, topicEngine.decisionSupport.materials, topicEngine.currentTopic],
  );
  const currentDiscussionState = useMemo(
    () => buildCurrentDiscussionState(topicEngine.meetingGraph, topicEngine.currentTopicId, topicEngine.decisionGraph, topicEngine.segmentArchive),
    [topicEngine.meetingGraph, topicEngine.currentTopicId, topicEngine.decisionGraph, topicEngine.segmentArchive],
  );
  // Selecting a node keeps the user on the dashboard: evidence renders inline
  // (state+evidence unified, see ADR 0019). Only an explicit "関係を詳しく見る"
  // click opens the separate advanced trace map (mapMode "state").
  const exploreFromDashboard = useCallback((id: string) => setSelectedDecisionId(id), []);
  const openTraceMap = useCallback(() => setMapMode("state"), []);
  const selectedDashboardNode = useMemo(
    () => topicEngine.meetingStateGraph.nodes.find((node) => node.id === selectedDecisionId) ?? null,
    [topicEngine.meetingStateGraph, selectedDecisionId],
  );
  const selectedDashboardNodeParents = useMemo(
    () => (selectedDecisionId ? selectDecisionParents(topicEngine.meetingStateGraph, selectedDecisionId).filter((node) => node.id !== selectedDecisionId) : []),
    [topicEngine.meetingStateGraph, selectedDecisionId],
  );
  const stopSpeech = speech.stop;
  const flushMeeting = topicEngine.flushBuffer;
  useEffect(() => { if (!active) { stopSpeech(); flushMeeting(); } }, [active, stopSpeech, flushMeeting]);
  useEffect(() => {
    if (topicEngine.segmentArchive.length !== lastSavedSegmentCount.current && saveStatus === "saved") setSaveStatus("dirty");
    lastSavedSegmentCount.current = topicEngine.segmentArchive.length;
  }, [topicEngine.segmentArchive.length, saveStatus]);
  const [inputDockOpen, setInputDockOpen] = useState(false);
  const [inputTab, setInputTab] = useState<MeetingInputTab>("manual");
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [selectedConversationNodeId, setSelectedConversationNodeId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stableStatusLabel = useMemo(
    () => statusLabel(speech.isSupported, speech.isListening),
    [speech.isListening, speech.isSupported],
  );

  const elapsedLabel = useMemo(() => formatReplayTime(now - topicEngine.meetingStartedAt), [now, topicEngine.meetingStartedAt]);
  const organizeMeeting = () => {
    speech.stop();
    topicEngine.flushBuffer();
    setMapMode("summary");
    void topicEngine.organizeMeeting();
  };
  const finishMeeting = () => {
    speech.stop();
    setEndedView("minutes");
    topicEngine.finishMeeting();
  };
  const correctSemanticItem = useCallback((target: { utteranceId: string; unitId?: string }, axes: Partial<import("../semantic/types").SemanticAxes>) => {
    if (saveStatus === "saved") setSaveStatus("dirty");
    void topicEngine.recordSemanticCorrection(target, axes).then((result) => {
      if (result.ok) {
        if (saveStatus === "saved") setSaveStatus("saved");
      } else {
        setSaveStatus("failed");
        setSaveError(result.error ?? "訂正を保存できませんでした。");
      }
    });
  }, [saveStatus, topicEngine.recordSemanticCorrection]);
  useEffect(() => {
    const hasUnsavedData = topicEngine.segmentArchive.length > 0 && saveStatus !== "saved";
    if (!hasUnsavedData && saveStatus !== "dirty" && saveStatus !== "failed") return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [saveStatus, topicEngine.segmentArchive.length]);
  const endedAt = topicEngine.meetingEndedAt;
  const minutes = topicEngine.minutes;
  if (endedAt !== null && minutes) {
    return <div className="minutes-workspace">
      <nav className="workspace-tabs" aria-label="終了した会議">
        <button type="button" aria-pressed={endedView === "minutes"} onClick={() => setEndedView("minutes")}>議事録</button>
        <button type="button" aria-pressed={endedView === "timeline"} onClick={() => setEndedView("timeline")}>発言タイムライン</button>
        <button type="button" onClick={() => {
          topicEngine.resumeMeeting();
          if (saveStatus === "saved") setSaveStatus("dirty");
        }}>会議を再開</button>
      </nav>
      {endedView === "minutes" ? <MeetingReviewQueue minutes={minutes}
        saved={saveStatus === "saved"} saveStatus={saveStatus} saveError={saveError} savedMeetings={savedMeetings}
        onSave={() => {
          setSaveStatus("saving");
          void topicEngine.saveMeeting().then((result) => {
            if (result.ok) lastSavedSegmentCount.current = topicEngine.segmentArchive.length;
            setSaveStatus(result.ok ? "saved" : "failed");
            setSaveError(result.error ?? null);
          });
        }}
        onListSaved={() => { void topicEngine.listSavedMeetings().then((result) => {
          if (result.ok) setSavedMeetings(result.meetings ?? []);
          else { setSaveStatus("failed"); setSaveError(result.error ?? "保存一覧を読み込めませんでした。"); }
        }); }}
        onRestore={(id) => { void topicEngine.restoreMeeting(id).then((result) => {
          if (result.ok) {
            const utterances = topicEngine.getArchive()?.events.filter((event) => event.kind === "utterance_added").length ?? 0;
            lastSavedSegmentCount.current = utterances;
            setSaveStatus("saved"); setSaveError(null);
          }
          else { setSaveStatus("failed"); setSaveError(result.error ?? "復元に失敗しました。"); }
        }); }}
        onDeleteSaved={(id) => { void topicEngine.deleteSavedMeeting(id).then((result) => {
          if (result.ok) setSavedMeetings((items) => items.filter((item) => item.id !== id));
          else { setSaveStatus("failed"); setSaveError(result.error ?? "削除に失敗しました。"); }
        }); }}
        metadata={{ title: topicEngine.meetingGraph.title, startedAt: topicEngine.meetingStartedAt, endedAt }}
        onReview={topicEngine.reviewMinutes} /> :
        <ConversationView
          conversationTree={topicEngine.conversationTree}
          timelineRows={topicEngine.timelineRows}
          selectedNodeId={selectedConversationNodeId}
          onRate={topicEngine.toggleConversationNodeRating}
          onSelect={setSelectedConversationNodeId}
          onCorrect={correctSemanticItem}
        />}
    </div>;
  }

  return (
    <>
      <header className="meeting-header">
        <div>
          <p className="eyebrow">会議ワークスペース</p>
          <h1>{topicEngine.meetingGraph.title}</h1>
        </div>
        <div className="header-metrics">
          <div className="header-metric">
            <span className={`connection-dot ${speech.isListening ? "is-live" : ""}`} />
            <strong>{speech.isListening ? "録音中" : "待機中"}</strong>
          </div>
          <div className="header-metric"><span>経過</span><strong>{elapsedLabel}</strong></div>
        </div>
      </header>

      <details className="saved-meetings-library">
        <summary onClick={() => { void topicEngine.listSavedMeetings().then((result) => {
          if (result.ok) setSavedMeetings(result.meetings ?? []);
          else { setSaveStatus("failed"); setSaveError(result.error ?? "保存一覧を読み込めませんでした。"); }
        }); }}>保存済み会議を開く</summary>
        <p>この端末のブラウザー内に保存した会議です。</p>
        {savedMeetings.length ? <ul>{savedMeetings.map((meeting) => <li key={meeting.id}>
          <span>{meeting.title} · {new Date(meeting.endedAt).toLocaleString("ja-JP")}</span>
          <button type="button" onClick={() => { void topicEngine.restoreMeeting(meeting.id).then((result) => {
            if (result.ok) {
              const utterances = topicEngine.getArchive()?.events.filter((event) => event.kind === "utterance_added").length ?? 0;
              lastSavedSegmentCount.current = utterances;
              setSaveStatus("saved"); setSaveError(null);
            }
            else { setSaveStatus("failed"); setSaveError(result.error ?? "復元に失敗しました。"); }
          }); }}>開く</button>
          <button type="button" onClick={() => { void topicEngine.deleteSavedMeeting(meeting.id).then((result) => {
            if (result.ok) setSavedMeetings((items) => items.filter((item) => item.id !== meeting.id));
            else { setSaveStatus("failed"); setSaveError(result.error ?? "削除に失敗しました。"); }
          }); }}>削除</button>
        </li>)}</ul> : <p>保存済み会議はありません。</p>}
      </details>

      <section className="dashboard-grid">
        <aside className="meeting-agenda-column">
          <section className="meeting-agenda-card">
            <p className="eyebrow">議事進行</p><h2>会議プロセス</h2>
            <div className="agenda-current"><span>現在の議題</span><strong>{currentDiscussionState.topicTitle ?? "議題はまだありません"}</strong></div>
            <div className="agenda-count"><span>記録した発言</span><strong>{topicEngine.segmentArchive.length}</strong><small>件</small></div>
            <div className="agenda-guide"><span className="agenda-guide-step is-current">1</span><div><strong>発言を集める</strong><small>音声またはテキストで追加</small></div></div>
            <div className="agenda-guide"><span className={`agenda-guide-step ${topicEngine.segmentArchive.length ? "is-current" : ""}`}>2</span><div><strong>考えを整理する</strong><small>話題・課題・理由・行動</small></div></div>
            <div className="agenda-guide"><span className={`agenda-guide-step ${topicEngine.discussionPrompts.length ? "is-current" : ""}`}>3</span><div><strong>次の確認へ</strong><small>未解決の点を明らかにする</small></div></div>
            <button type="button" className="quiet-button" onClick={() => setIsResetConfirmOpen(true)}>会議をリセット</button>
          </section>
        </aside>
        <div className={`graph-column ${mapMode === "state" || mapMode === "dashboard" ? "is-state-map" : ""}`}>
          <ControlPanel
            error={speech.error} isListening={speech.isListening} isSupported={speech.isSupported}
            onReset={() => setIsResetConfirmOpen(true)} onOrganize={organizeMeeting}
            onFinish={minutes ? finishMeeting : undefined}
            canFinish={topicEngine.segmentArchive.length > 0 || Boolean(topicEngine.bufferText.trim())}
            canOrganize={topicEngine.segmentArchive.length > 0}
            isOrganizing={topicEngine.meetingSummaryStatus === "refining"}
            onStart={speech.isSupported ? speech.start : () => setInputDockOpen(true)} onStop={() => { speech.stop(); topicEngine.flushBuffer(); }}
            statusLabel={stableStatusLabel}
          />
          {mapMode === "dashboard" ? (
            <MeetingStateDashboard
              currentDiscussionState={currentDiscussionState}
              confirmedDecisions={dashboard.confirmedDecisions}
              reasonsByDecisionId={dashboard.reasonsByDecisionId}
              structuralGaps={dashboard.structuralGaps}
              openItems={dashboard.openItems}
              pendingProposals={dashboard.pendingProposals}
              systemSuggestedChecks={dashboard.systemSuggestedChecks}
              humanConfirmedChecks={dashboard.humanConfirmedChecks}
              nextActions={dashboard.nextActions}
              onExplore={exploreFromDashboard}
              selectedNode={selectedDashboardNode}
              selectedNodeParents={selectedDashboardNodeParents}
              onCloseSelection={() => setSelectedDecisionId(null)}
              onOpenTraceMap={openTraceMap}
              onOpenDecisionSupport={topicEngine.analyzeDecisionSupport}
              onStartReview={() => setMapMode("progress")}
            />
          ) : mapMode === "progress" ? (
            <MeetingProgressMap tree={topicEngine.conversationTree} graph={topicEngine.decisionGraph} segments={topicEngine.segmentArchive}
              meetingReview={topicEngine.meetingReview} onReviewChange={topicEngine.setMeetingReview}
              prompts={topicEngine.discussionPrompts} reviewStatus={topicEngine.progressReviewStatus} reviewError={topicEngine.progressReviewError}
              armedPromptId={topicEngine.armedDiscussionPrompt?.id ?? null} onArmPrompt={topicEngine.armDiscussionPrompt}
              onAnswer={(id, text, needsResearch) => { topicEngine.answerDiscussionPrompt(id, text, needsResearch); designHinge.ingestUtterance(text, "manual"); }}
              onDefer={topicEngine.setDiscussionPromptDeferred} onExplore={(id) => { setSelectedDecisionId(id); setMapMode("state"); }}
              onSubmit={(text) => { topicEngine.submitTranscript(text, "manual"); designHinge.ingestUtterance(text, "manual"); }} onStart={speech.isSupported ? speech.start : () => setInputDockOpen(true)} />
          ) : mapMode === "state" ? (
            <MeetingStateMap graph={topicEngine.decisionGraph} meetingId={topicEngine.meetingGraph.meetingId} title={topicEngine.meetingGraph.title} selectedId={selectedDecisionId} onSelect={setSelectedDecisionId} />
          ) : mapMode === "summary" && topicEngine.meetingSummary ? (
            <MeetingSummaryGraph
              error={topicEngine.meetingSummaryError}
              onBack={() => setMapMode("live")}
              onRefresh={organizeMeeting}
              onRename={topicEngine.renameMeetingSummaryNode}
              onStartIdeaSession={(selectedItemIds) =>
                onStartIdeaSession(topicEngine.meetingSummary!, topicEngine.segmentArchive, selectedItemIds)
              }
              segments={topicEngine.segmentArchive}
              stale={topicEngine.meetingSummaryStale}
              startedAt={topicEngine.meetingSummaryStartedAt}
              status={topicEngine.meetingSummaryStatus}
              summary={topicEngine.meetingSummary}
            />
          ) : (
            <ConversationView
              conversationTree={topicEngine.conversationTree}
              timelineRows={topicEngine.timelineRows}
              selectedNodeId={selectedConversationNodeId}
              onRate={topicEngine.toggleConversationNodeRating}
              onSelect={setSelectedConversationNodeId}
              onCorrect={correctSemanticItem}
              onStart={speech.start}
            />
          )}
          <details className="map-alternatives"><summary>別のマップ・詳細表示</summary><div className="map-alternative-buttons">
            <button aria-pressed={mapMode === "dashboard"} onClick={() => setMapMode("dashboard")}>会議の状況</button>
            <button aria-pressed={mapMode === "progress"} onClick={() => setMapMode("progress")}>流れと次の検討</button>
            <button aria-pressed={mapMode === "state"} onClick={() => setMapMode("state")}>関係を詳しく見る（根拠マップ）</button>
            <button aria-pressed={mapMode === "live"} onClick={() => setMapMode("live")}>会話マップ</button>
            {topicEngine.meetingSummary ? <button aria-pressed={mapMode === "summary"} onClick={() => setMapMode("summary")}>整理マップ</button> : null}
          </div></details>
        </div>

        <div className="rail-column meeting-rail">
          <ActionView graph={topicEngine.decisionGraph} onUpdate={topicEngine.updateAction} onExplore={(id) => { setSelectedDecisionId(id); setMapMode("state"); }} />
          <DecisionSupportPanel analysis={topicEngine.decisionSupport} segments={topicEngine.segmentArchive} onAnalyze={topicEngine.analyzeDecisionSupport} onStatus={topicEngine.updateDecisionMaterialStatus} />
          <details className="secondary-tools"><summary>会話マップの調整</summary><ConversationNodeEditor
              conversationTree={topicEngine.conversationTree}
              selectedNodeId={selectedConversationNodeId}
              onUpdate={topicEngine.updateConversationNode}
          /></details>
          <details className="secondary-tools"><summary>分析・レポート・設定</summary><MeetingReportPanel
              conversationTree={topicEngine.conversationTree}
              importantMentions={topicEngine.importantMentions}
              llmSettings={llmSettings}
              meetingGraph={topicEngine.meetingGraph}
              decisionGraph={topicEngine.decisionGraph}
              onUpdateLlmSettings={updateLlmSettings}
              segmentArchive={topicEngine.segmentArchive}
            /><DesignHingePanel
              activeCard={designHinge.activeCard} graph={designHinge.graph}
              pendingProposals={designHinge.pendingProposals} pendingCandidateQueue={designHinge.pendingCandidateQueue}
              policyEnabled={designHinge.policyEnabled} acceptNodeProposal={designHinge.acceptNodeProposal}
              acceptEdgeProposal={designHinge.acceptEdgeProposal} rejectEdgeProposal={designHinge.rejectEdgeProposal}
              approveIntervention={designHinge.approveIntervention} dismissIntervention={designHinge.dismissIntervention}
              createCounterfactual={designHinge.createCounterfactual} requestManualIntervention={designHinge.requestManualIntervention}
              setPolicyEnabled={designHinge.setPolicyEnabled} exportSession={designHinge.exportSession}
            /><TopicInspector
              currentTopicGaps={topicEngine.currentTopicGaps}
              currentTopicId={topicEngine.currentTopicId}
              decisionLogs={topicEngine.decisionLogs}
              focusState={topicEngine.focusState}
              importantMentions={topicEngine.importantMentions}
              logs={topicEngine.logs}
              meetingGraph={topicEngine.meetingGraph}
              onFocusLockedChange={topicEngine.setFocusLocked}
              onManualFocusChange={topicEngine.setManualFocus}
              segments={topicEngine.segments}
          /></details>
        </div>
      </section>

      <section className={`meeting-input-dock ${inputDockOpen ? "is-open" : ""}`} aria-label="入力と再生ツール">
        <button
          type="button"
          className="meeting-input-dock-toggle"
          aria-expanded={inputDockOpen}
          aria-controls="meeting-input-dock-content"
          onClick={() => setInputDockOpen((open) => !open)}
        >
          <span>入力・再生</span>
          <span aria-hidden="true">{inputDockOpen ? "閉じる −" : "開く ＋"}</span>
        </button>
        <div id="meeting-input-dock-content" className="meeting-input-dock-content" hidden={!inputDockOpen}>
          <div className="workspace-tabs input-dock-tabs" role="tablist" aria-label="入力と再生の種類">
            {([
              ["manual", "手入力・シナリオ"],
              ["replay", "ファイル再生"],
              ["transcript", "発話ログ"],
            ] as const).map(([tab, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={inputTab === tab}
                aria-controls={`meeting-input-${tab}-panel`}
                id={`meeting-input-${tab}-tab`}
                key={tab}
                onClick={() => setInputTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="meeting-input-manual-panel" aria-labelledby="meeting-input-manual-tab" hidden={inputTab !== "manual"}>
            <ManualReplayPanel
              onSubmit={(text, source) => {
                topicEngine.submitTranscript(text, source);
                designHinge.ingestUtterance(text, source);
              }}
            />
          </div>
          <div role="tabpanel" id="meeting-input-replay-panel" aria-labelledby="meeting-input-replay-tab" hidden={inputTab !== "replay"}>
            <TranscriptReplayPanel
              active={active}
              onSubmit={(segment) => {
                topicEngine.submitTimedTranscript(segment);
                designHinge.ingestUtterance(segment.text, "replay");
              }}
            />
          </div>
          <div role="tabpanel" id="meeting-input-transcript-panel" aria-labelledby="meeting-input-transcript-tab" hidden={inputTab !== "transcript"}>
            <TranscriptPanel
              bufferText={topicEngine.bufferText}
              interimText={speech.interimText}
              lastFinalText={speech.lastFinalText}
              meetingGraph={topicEngine.meetingGraph}
              segments={topicEngine.segments}
            />
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="セッションをリセットしますか?"
        description="収集した発言・議題・要約はすべて削除され、元に戻せません。"
        confirmLabel="リセットする"
        onConfirm={() => {
          topicEngine.reset();
          designHinge.reset();
          setSelectedConversationNodeId(null);
          setSelectedDecisionId(null);
          setMapMode("dashboard");
          setIsResetConfirmOpen(false);
        }}
        onCancel={() => setIsResetConfirmOpen(false)}
      />
    </>
  );
}
