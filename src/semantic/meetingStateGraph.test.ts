import { describe, expect, it } from "vitest";
import { buildMeetingStateDashboard } from "../utils/meetingStateDashboard";
import { createCanonicalState } from "./canonicalReducer";
import { meetingStateGraphFromProjection } from "./meetingStateGraph";
import { projectMeetingState, type MeetingStateProjection } from "./meetingStateProjection";
import { runSidecarCase } from "./runSidecar";
import { loadCorpus } from "./__corpus__/loadCorpus";
import type { CanonicalEntry } from "./types";

function caseById(id: string) {
  const testCase = loadCorpus().find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`corpus case ${id} not found`);
  return testCase;
}

const createdAtOf = () => 1000;

function emptyProjection(): MeetingStateProjection {
  return {
    confirmedDecisions: [], provisionalDecisions: [], actions: [], deferred: [], questions: [],
    unresolved: [], proposals: [], options: [], problems: [], topics: [], context: [],
  };
}

function entry(overrides: Partial<CanonicalEntry>): CanonicalEntry {
  return {
    id: "u1:decision",
    kind: "decision",
    label: "対戦ゲーム形式を採用します",
    basis: "rule_explicit",
    evidence: { utteranceIds: ["u1"], assertionIds: ["a1"] },
    promotedBy: { policyVersion: "test" },
    entityRevision: 1,
    ...overrides,
  };
}

describe("meetingStateGraphFromProjection", () => {
  it("maps a rule-explicit decision to a decided decision node, labelled as rule output not human", () => {
    const projection = { ...emptyProjection(), confirmedDecisions: [entry({})] };
    const graph = meetingStateGraphFromProjection(projection, createdAtOf);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ type: "decision", state: "decided", createdAt: 1000 });
    expect(graph.nodes[0].provenance.createdBy).toBe("ai");
  });

  it("keeps a provisional decision unconfirmed (I6)", () => {
    const projection = { ...emptyProjection(), provisionalDecisions: [entry({ basis: "provisional" })] };
    const graph = meetingStateGraphFromProjection(projection, createdAtOf);

    expect(graph.nodes[0].state).toBe("unconfirmed");
  });

  it("labels a human-confirmed entry as human provenance", () => {
    const projection = { ...emptyProjection(), confirmedDecisions: [entry({ basis: "human_confirmed" })] };
    const graph = meetingStateGraphFromProjection(projection, createdAtOf);

    expect(graph.nodes[0].provenance.createdBy).toBe("human");
  });

  it("carries owner and deadline of a promoted action, and leaves them unset when absent", () => {
    const projection = {
      ...emptyProjection(),
      actions: [
        entry({ id: "u2:action", kind: "action", label: "プロトタイプを作成します", owner: "鈴木", deadline: "来週金曜日" }),
        entry({ id: "u3:action", kind: "action", label: "確認を取ります", owner: null, deadline: null }),
      ],
    };
    const graph = meetingStateGraphFromProjection(projection, createdAtOf);

    expect(graph.nodes[0].action).toEqual({ what: "プロトタイプを作成します", owner: "鈴木", deadline: "来週金曜日", status: "decided" });
    expect(graph.nodes[1].action).toMatchObject({ owner: undefined, deadline: undefined, status: "decided" });
  });

  it("produces one node per displayed entry: nothing dropped, nothing duplicated", () => {
    const { canonical } = runSidecarCase(caseById("11-action-commitment"));
    const projection = projectMeetingState(canonical);
    const displayed = [
      ...projection.confirmedDecisions, ...projection.provisionalDecisions, ...projection.actions,
      ...projection.questions, ...projection.proposals, ...projection.unresolved, ...projection.deferred,
    ];
    const graph = meetingStateGraphFromProjection(projection, createdAtOf);

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(displayed.map((item) => item.id).sort());
  });

  it("feeds the dashboard without admitting a process greeting as a decision or action (I4)", () => {
    const { canonical } = runSidecarCase(caseById("18-process-greeting"));
    const graph = meetingStateGraphFromProjection(projectMeetingState(canonical), createdAtOf);
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    expect(dashboard.confirmedDecisions).toEqual([]);
    expect(dashboard.nextActions).toEqual([]);
  });

  it("shows an empty canonical state as an empty dashboard", () => {
    const graph = meetingStateGraphFromProjection(projectMeetingState(createCanonicalState()), createdAtOf);

    expect(graph).toEqual({ nodes: [], edges: [] });
  });
});
