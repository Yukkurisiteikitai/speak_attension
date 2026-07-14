import { describe, expect, it } from "vitest";
import { createInitialMeetingGraph, projectGraphToFlow, estimateTopicNodeHeight } from "./topicProjection";
import type { GraphTopicNodeData, MeetingGraph, TopicNode } from "../types/topic";

function createTestTopic(
  id: string,
  title: string,
  overrides: Partial<TopicNode> = {},
): TopicNode {
  return {
    id,
    title,
    aliases: [title],
    lifecycle: "discussed",
    displayStates: ["discussed"],
    coverage: {
      decision: false,
      reason: false,
      owner: false,
      dueDate: false,
      risk: false,
      alternative: false,
      objection: false,
      nextAction: false,
      dependency: false,
      openQuestionResolved: false,
    },
    evidenceSegmentIds: [],
    mentionCount: 1,
    openQuestionCount: 0,
    firstSeenAt: 0,
    lastSeenAt: 0,
    lastActivatedAt: null,
    closedAt: null,
    lastActivatedSegmentIndex: -1,
    ...overrides,
  };
}

type Rect = { x: number; y: number; width: number; height: number };

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertNoOverlaps(rects: Rect[]) {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j])) {
        throw new Error(`Overlap detected: rect ${i} and rect ${j}\nrect ${i}: ${JSON.stringify(rects[i])}\nrect ${j}: ${JSON.stringify(rects[j])}`);
      }
    }
  }
}

describe("estimateTopicNodeHeight", () => {
  it("returns minimum height for short titles", () => {
    const data: GraphTopicNodeData = {
      label: "A",
      kind: "topic",
      states: [],
    };
    const height = estimateTopicNodeHeight(data);
    expect(height).toBeGreaterThanOrEqual(90);
  });

  it("increases height for longer content", () => {
    const shortData: GraphTopicNodeData = {
      label: "Short",
      kind: "topic",
      states: [],
    };
    const longData: GraphTopicNodeData = {
      label: "オフラインでも動く高精度な音声認識と自動要約機能と多くの機能が詰まった非常に長い題名",
      kind: "topic",
      states: ["discussed", "decided"],
      lifecycle: "decided",
    };
    const shortHeight = estimateTopicNodeHeight(shortData);
    const longHeight = estimateTopicNodeHeight(longData);
    expect(longHeight).toBeGreaterThan(shortHeight);
  });
});

describe("projectGraphToFlow - topic grid layout", () => {
  it("produces non-overlapping nodes for 6+ topics in multi-row grid", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");

    // Add 6 topics to create multi-row layout
    const topics = [
      createTestTopic("t1", "Topic 1"),
      createTestTopic("t2", "Topic 2 With Longer Title"),
      createTestTopic("t3", "トピック3"),
      createTestTopic("t4", "Topic 4 - 非常に長いタイトルです"),
      createTestTopic("t5", "トピック5"),
      createTestTopic("t6", "Topic 6"),
    ];

    graph.nodes = [graph.nodes[0], ...topics];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    // Collect AABB rectangles for all nodes except root
    const rects: Rect[] = result.nodes
      .filter((node) => node.id !== graph.rootTopicId)
      .map((node) => {
        const data = node.data as GraphTopicNodeData;
        const width = 200; // approximate topic node width
        const height = estimateTopicNodeHeight(data);
        return {
          x: node.position.x,
          y: node.position.y,
          width,
          height,
        };
      });

    assertNoOverlaps(rects);
  });

  it("guarantees zero overlaps with gap nodes in separate column", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");

    const topics = [
      createTestTopic("t1", "Topic 1"),
      createTestTopic("t2", "Topic 2"),
      createTestTopic("t3", "Topic 3"),
    ];

    graph.nodes = [graph.nodes[0], ...topics];

    // Add gaps for each topic
    graph.gaps = [
      {
        id: "gap-1-a",
        topicId: "t1",
        type: "missing_decision",
        title: "Gap 1.1",
        detail: "Detail",
        severity: "high",
        createdAt: 0,
        closedAt: null,
      },
      {
        id: "gap-1-b",
        topicId: "t1",
        type: "missing_reason",
        title: "Gap 1.2",
        detail: "Detail",
        severity: "medium",
        createdAt: 0,
        closedAt: null,
      },
      {
        id: "gap-2-a",
        topicId: "t2",
        type: "missing_owner",
        title: "Gap 2.1",
        detail: "Detail",
        severity: "high",
        createdAt: 0,
        closedAt: null,
      },
      {
        id: "gap-3-a",
        topicId: "t3",
        type: "missing_decision",
        title: "Gap 3.1",
        detail: "Detail",
        severity: "low",
        createdAt: 0,
        closedAt: null,
      },
    ];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    // Collect AABB rectangles for all nodes
    const rects: Rect[] = result.nodes
      .filter((node) => node.id !== graph.rootTopicId)
      .map((node) => {
        const data = node.data as GraphTopicNodeData;
        const width = data.kind === "gap" ? 180 : 200;
        const height = data.kind === "gap" ? 60 : estimateTopicNodeHeight(data);
        return {
          x: node.position.x,
          y: node.position.y,
          width,
          height,
        };
      });

    assertNoOverlaps(rects);

    // Verify gaps are in a separate column (x >= 1000)
    const gapNodes = result.nodes.filter((node) => (node.data as GraphTopicNodeData).kind === "gap");
    gapNodes.forEach((node) => {
      expect(node.position.x).toBeGreaterThanOrEqual(1000);
    });
  });

  it("is deterministic for the same input", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");

    const topics = [
      createTestTopic("t1", "Topic 1"),
      createTestTopic("t2", "Topic 2"),
      createTestTopic("t3", "Topic 3"),
    ];

    graph.nodes = [graph.nodes[0], ...topics];
    graph.gaps = [
      {
        id: "gap-1",
        topicId: "t1",
        type: "missing_decision",
        title: "Gap",
        detail: "Detail",
        severity: "high",
        createdAt: 0,
        closedAt: null,
      },
    ];

    const result1 = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    const result2 = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    expect(result1.nodes.map((n) => n.position)).toEqual(result2.nodes.map((n) => n.position));
  });

  it("maintains 3-column grid layout", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");

    const topics = Array.from({ length: 6 }, (_, i) => createTestTopic(`t${i + 1}`, `Topic ${i + 1}`));
    graph.nodes = [graph.nodes[0], ...topics];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    const topicNodes = result.nodes.filter((n) => (n.data as GraphTopicNodeData).kind === "topic");

    // Verify 3-column layout: topics 0-2 should have same X with 300px spacing
    const x0 = topicNodes[0].position.x;
    const x1 = topicNodes[1].position.x;
    const x2 = topicNodes[2].position.x;

    expect(x1 - x0).toBeCloseTo(300, 0);
    expect(x2 - x1).toBeCloseTo(300, 0);

    // Topics 3-5 should have same X coordinates as 0-2
    expect(topicNodes[3].position.x).toBeCloseTo(x0, 0);
    expect(topicNodes[4].position.x).toBeCloseTo(x1, 0);
    expect(topicNodes[5].position.x).toBeCloseTo(x2, 0);
  });
});
