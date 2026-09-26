import { describe, expect, it } from "vitest";
import type { AnalyzedSegment, DecisionMaterial, MeetingDecisionGraph } from "../types/topic";
import {
  appendMeetingDecisionSegment,
  createInitialMeetingDecisionGraph,
  selectCurrentActions,
  selectDecisionParents,
} from "./meetingDecisionGraph";
import { buildMeetingStateDashboard } from "./meetingStateDashboard";

function segment(id: string, text: string, createdAt: number): AnalyzedSegment {
  return {
    id,
    text,
    createdAt,
    source: "manual",
    matchedTopicIds: [],
    analysis: {
      selectedTopicId: null,
      selectedTopicLabel: null,
      matchedTopicIds: [],
      intent: "unknown",
      focusRelation: "uncertain",
      focusAlignmentScore: 0,
      candidateTopicPhrases: [],
      topicScores: [],
      resolvedReferences: [],
      unresolvedReferences: [],
      shouldUpdateGraph: false,
      shouldUpdateCurrentTopic: false,
      shouldCreateNode: false,
      coverageUpdates: [],
      createdGapIds: [],
      reason: "test",
    },
  };
}

describe("buildMeetingStateDashboard", () => {
  it("case 1: proposal produces empty confirmedDecisions and proposal in unresolvedItems", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("prop1", "金曜日を第一候補にしましょう", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.confirmedDecisions).toEqual([]);
    expect(dashboard.unresolvedItems).toHaveLength(1);
    expect(dashboard.unresolvedItems[0].type).toBe("proposal");
    expect(dashboard.unresolvedItems[0].state).toBe("proposed");
  });

  it("case 2: decision produces confirmedDecisions entry", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("dec1", "金曜日に公開すると決めます", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.confirmedDecisions).toHaveLength(1);
    expect(dashboard.confirmedDecisions[0].type).toBe("decision");
    expect(dashboard.confirmedDecisions[0].state).toBe("decided");
  });

  it("case 3a: decided action with only deadline missing produces structuralGaps with missing: ['deadline']", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("act1", "田中さんが対応します", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.structuralGaps).toHaveLength(1);
    expect(dashboard.structuralGaps[0].missing).toEqual(["deadline"]);
  });

  it("case 3b: decided action with only owner missing produces structuralGaps with missing: ['owner']", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("act2", "明日までに対応します", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.structuralGaps).toHaveLength(1);
    expect(dashboard.structuralGaps[0].missing).toEqual(["owner"]);
  });

  it("case 3c: decided action with both owner and deadline missing produces structuralGaps with missing: ['owner', 'deadline']", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("act3", "対応します", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.structuralGaps).toHaveLength(1);
    expect(dashboard.structuralGaps[0].missing).toEqual(["owner", "deadline"]);
  });

  it("case 4: decided action with both owner and deadline produces NO gap and IS in nextActions", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("act4", "田中さんが明日までに対応します", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.structuralGaps).toEqual([]);
    expect(dashboard.nextActions).toHaveLength(1);
    expect(dashboard.nextActions[0].action?.owner).toBe("田中");
    expect(dashboard.nextActions[0].action?.deadline).toBe("明日まで");
  });

  it("case 5: DecisionMaterial with status 'open' appears in aiSuggestedChecks only", () => {
    const graph = createInitialMeetingDecisionGraph();
    const materials: DecisionMaterial[] = [
      {
        id: "mat1",
        kind: "meeting_fact",
        title: "Check 1",
        question: "Is this needed?",
        status: "open",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp1",
      },
    ];
    const dashboard = buildMeetingStateDashboard(graph, materials, null);

    expect(dashboard.aiSuggestedChecks).toHaveLength(1);
    expect(dashboard.humanConfirmedChecks).toHaveLength(0);
    expect(dashboard.confirmedDecisions).toEqual([]);
    expect(dashboard.structuralGaps).toEqual([]);
  });

  it("case 6: DecisionMaterial with status 'checked' appears in humanConfirmedChecks only", () => {
    const graph = createInitialMeetingDecisionGraph();
    const materials: DecisionMaterial[] = [
      {
        id: "mat2",
        kind: "comparison",
        title: "Check 2",
        question: "Which is better?",
        status: "checked",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp2",
      },
    ];
    const dashboard = buildMeetingStateDashboard(graph, materials, null);

    expect(dashboard.humanConfirmedChecks).toHaveLength(1);
    expect(dashboard.aiSuggestedChecks).toHaveLength(0);
  });

  it("case 7: traceability - reasonsByDecisionId reaches deeper evidence via selectDecisionParents composition", () => {
    // Build a causal chain: evidence → reason → risk → decision → action
    const texts = [
      "エラー率が35%になっています",
      "新バージョンが原因です",
      "このまま動かすと壊れたデータが増える",
      "v1.42に戻そう",
      "それでいこう。今すぐロールバック",
    ];
    const graph = texts.reduce(
      (current, text, index) => appendMeetingDecisionSegment(current, segment(`s${index + 1}`, text, 1000 + index)),
      createInitialMeetingDecisionGraph(),
    );

    const dashboard = buildMeetingStateDashboard(graph, [], null);

    // Should have one confirmed decision
    expect(dashboard.confirmedDecisions).toHaveLength(1);
    const decision = dashboard.confirmedDecisions[0];

    // reasonsByDecisionId should contain parents
    expect(dashboard.reasonsByDecisionId[decision.id]).toBeDefined();
    const reasons = dashboard.reasonsByDecisionId[decision.id];
    expect(reasons.length).toBeGreaterThan(0);

    // Further call to selectDecisionParents on a reason should reach deeper
    if (reasons.length > 0) {
      const reasonNode = reasons[0];
      const deeperParents = selectDecisionParents(graph, reasonNode.id);
      expect(deeperParents.length).toBeGreaterThan(0);
    }
  });

  it("case 8: topic-boundary isolation - new decision doesn't include pre-boundary evidence in reasonsByDecisionId", () => {
    // Build graph crossing a boundary
    const texts = [
      "エラー率が35%になっています",
      "新バージョンが原因です",
      "このまま動かすと壊れたデータが増える",
      "v1.42に戻そう",
      "それでいこう。今すぐロールバック",
      "次の議題です", // explicit boundary
      "資料を作成します",
    ];
    const graph = texts.reduce(
      (current, text, index) => appendMeetingDecisionSegment(current, segment(`s${index + 1}`, text, 1000 + index)),
      createInitialMeetingDecisionGraph(),
    );

    const dashboard = buildMeetingStateDashboard(graph, [], null);

    // Should have two decisions (one before boundary, one after)
    expect(dashboard.confirmedDecisions.length).toBeGreaterThanOrEqual(1);

    // Find the decision after the boundary (created later)
    const latestDecision = dashboard.confirmedDecisions.sort((a, b) => b.createdAt - a.createdAt)[0];

    // Its reasons should not include nodes from before the boundary
    const reasons = dashboard.reasonsByDecisionId[latestDecision.id];
    const reasonTypes = reasons.map((n) => n.type);
    // After boundary, "資料を作成します" creates an action+decision, whose reasons should not include risk from before boundary
    expect(reasonTypes).not.toContain("risk");
    expect(reasonTypes).not.toContain("evidence");
  });

  it("correctly handles mix of proposed and decided actions - only decided actions appear in nextActions", () => {
    const texts = ["対応します", "それでいこう"];
    const graph = texts.reduce(
      (current, text, index) => appendMeetingDecisionSegment(current, segment(`s${index}`, text, index)),
      createInitialMeetingDecisionGraph(),
    );
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.nextActions).toHaveLength(1);
    const action = dashboard.nextActions[0];
    expect(action.action?.status).toBe("decided");
  });

  it("action can appear in both structuralGaps AND nextActions - they are independent", () => {
    // Action with owner but no deadline - should be in both structuralGaps and nextActions
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("act", "田中さんが対応します", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.nextActions).toHaveLength(1);
    expect(dashboard.structuralGaps).toHaveLength(1);
    expect(dashboard.structuralGaps[0].actionId).toBe(dashboard.nextActions[0].id);
  });

  it("unconfirmed nodes appear in unresolvedItems and are never in confirmedDecisions", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("tentative", "新バージョンが原因かもしれない", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    const unconfirmed = graph.nodes.filter((n) => n.state === "unconfirmed");
    expect(unconfirmed.length).toBeGreaterThan(0);
    expect(dashboard.unresolvedItems.map((n) => n.id)).toContain(unconfirmed[0].id);
    expect(dashboard.confirmedDecisions).toEqual([]);
  });

  it("now spotlight: structural_gap priority over unresolved", () => {
    const graph = appendMeetingDecisionSegment(
      appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("q", "誰が担当しますか？", 1000)),
      segment("act", "対応します", 2000),
    );
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.now?.kind).toBe("structural_gap");
  });

  it("now spotlight: unresolved question priority over action when no gaps", () => {
    const graph = appendMeetingDecisionSegment(
      appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("q", "誰が担当しますか？", 1000)),
      segment("act", "田中さんが明日までに対応します", 2000),
    );
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.now).not.toBeNull();
    if (dashboard.now?.kind === "unresolved") {
      expect(dashboard.now.node.type).toBe("question");
    } else {
      expect.fail("Expected unresolved spotlight");
    }
  });

  it("now spotlight: action priority when no gaps or questions", () => {
    const graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("act", "田中さんが明日までに対応します", 1000));
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.now).not.toBeNull();
    if (dashboard.now?.kind === "action") {
      expect(dashboard.now.node.type).toBe("action");
    } else {
      expect.fail("Expected action spotlight");
    }
  });

  it("now spotlight: null when no gaps, questions, or actions", () => {
    const graph = createInitialMeetingDecisionGraph();
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.now).toBeNull();
  });

  it("currentTopicTitle is passed through unchanged", () => {
    const graph = createInitialMeetingDecisionGraph();
    const title = "会議のテーマ";
    const dashboard = buildMeetingStateDashboard(graph, [], title);

    expect(dashboard.currentTopicTitle).toBe(title);
  });

  it("multiple materials: mix of open, checked, decided, deferred", () => {
    const graph = createInitialMeetingDecisionGraph();
    const materials: DecisionMaterial[] = [
      {
        id: "m1",
        kind: "meeting_fact",
        title: "Check 1",
        question: "Is this needed?",
        status: "open",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp1",
      },
      {
        id: "m2",
        kind: "comparison",
        title: "Check 2",
        question: "Which is better?",
        status: "checked",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp2",
      },
      {
        id: "m3",
        kind: "value_choice",
        title: "Check 3",
        question: "Value choice?",
        status: "decided",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp3",
      },
      {
        id: "m4",
        kind: "meeting_fact",
        title: "Check 4",
        question: "Deferred?",
        status: "deferred",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp4",
      },
    ];
    const dashboard = buildMeetingStateDashboard(graph, materials, null);

    // open → aiSuggestedChecks
    expect(dashboard.aiSuggestedChecks).toHaveLength(1);
    expect(dashboard.aiSuggestedChecks[0].id).toBe("m1");

    // checked + decided → humanConfirmedChecks
    expect(dashboard.humanConfirmedChecks).toHaveLength(2);
    expect(dashboard.humanConfirmedChecks.map((m) => m.id)).toContain("m2");
    expect(dashboard.humanConfirmedChecks.map((m) => m.id)).toContain("m3");

    // deferred appears in neither
    expect(dashboard.aiSuggestedChecks.map((m) => m.id)).not.toContain("m4");
    expect(dashboard.humanConfirmedChecks.map((m) => m.id)).not.toContain("m4");
  });

  it("material with status 'recheck' appears in aiSuggestedChecks", () => {
    const graph = createInitialMeetingDecisionGraph();
    const materials: DecisionMaterial[] = [
      {
        id: "m5",
        kind: "meeting_fact",
        title: "Recheck",
        question: "Should recheck?",
        status: "recheck",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp5",
      },
    ];
    const dashboard = buildMeetingStateDashboard(graph, materials, null);

    expect(dashboard.aiSuggestedChecks).toHaveLength(1);
    expect(dashboard.aiSuggestedChecks[0].status).toBe("recheck");
  });

  it("material with status 'accepted' appears in humanConfirmedChecks", () => {
    const graph = createInitialMeetingDecisionGraph();
    const materials: DecisionMaterial[] = [
      {
        id: "m6",
        kind: "value_choice",
        title: "Accepted",
        question: "Is this accepted?",
        status: "accepted",
        confirmed: [],
        inferred: [],
        unknown: [],
        sourceEvidenceSegmentIds: [],
        conditionalHypothesis: { if: "", and: "", then: "", therefore: "" },
        rationale: "test",
        notNeededReason: "",
        premiseFingerprint: "fp6",
      },
    ];
    const dashboard = buildMeetingStateDashboard(graph, materials, null);

    expect(dashboard.humanConfirmedChecks).toHaveLength(1);
    expect(dashboard.humanConfirmedChecks[0].status).toBe("accepted");
  });

  it("proposal with relation 'decided_from' (adopted) does not appear in unresolvedItems", () => {
    let graph = appendMeetingDecisionSegment(createInitialMeetingDecisionGraph(), segment("prop", "方案Aを採用しましょう", 1000));
    const proposal = graph.nodes.find((n) => n.type === "proposal")!;

    // Manually add a decision edge
    graph = appendMeetingDecisionSegment(graph, segment("adopt", "それでいこう", 2000));
    const adoptedDashboard = buildMeetingStateDashboard(graph, [], null);

    // Proposal should not appear in unresolvedItems if it was adopted
    expect(adoptedDashboard.unresolvedItems.find((n) => n.id === proposal.id)).toBeUndefined();
  });
});
