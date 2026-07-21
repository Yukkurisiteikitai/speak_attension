import { describe, expect, it } from "vitest";
import { createInitialMeetingGraph, createTopicEdge, projectGraphToFlow, estimateTopicNodeHeight } from "./topicProjection";
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

function createTestSegment(id: string, text: string, topicId: string, createdAt: number) {
  return {
    id,
    text,
    createdAt,
    source: "manual",
    matchedTopicIds: [topicId],
    analysis: {},
  } as import("../types/topic").AnalyzedSegment;
}

describe("projectGraphToFlow - expandable meeting mind map", () => {
  it("stacks topic branches without overlaps for 6+ topics", () => {
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

    // Topic branches use two columns and need enough vertical room for long labels.
    const rects: Rect[] = result.nodes
      .filter((node) => node.id !== graph.rootTopicId)
      .map((node) => {
        const data = node.data as GraphTopicNodeData;
        const width = 270;
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

  it("does not create gap nodes; gaps stay on their topic while structural branches remain visible", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");

    const topics = [
      createTestTopic("t1", "Topic 1"),
      createTestTopic("t2", "Topic 2"),
      createTestTopic("t3", "Topic 3"),
    ];

    graph.nodes = [graph.nodes[0], ...topics];

    // Gaps still exist on the graph (surfaced in the Meeting Gaps panel), but should
    // never turn into graph nodes/edges - that's what caused the line clutter.
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
        id: "gap-2-a",
        topicId: "t2",
        type: "missing_owner",
        title: "Gap 2.1",
        detail: "Detail",
        severity: "high",
        createdAt: 0,
        closedAt: null,
      },
    ];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    expect(result.nodes).toHaveLength(4); // root + 3 topics, no gap nodes
    expect(result.nodes.every((node) => (node.data as GraphTopicNodeData).kind === "root" || (node.data as GraphTopicNodeData).kind === "topic")).toBe(true);
    expect(result.edges).toHaveLength(3); // root-to-topic branches only
    expect(result.edges.every((edge) => edge.data?.relation === "parent")).toBe(true);
  });

  it("keeps long topic and utterance nodes clear across both sides", () => {
    const graph = createInitialMeetingGraph("長い会議タイトルを含むテスト会議");
    const topics = Array.from({ length: 6 }, (_, index) =>
      createTestTopic(`t${index + 1}`, `議題${index + 1}: オフライン環境でも迷わず利用できる操作設計`),
    );
    graph.nodes = [graph.nodes[0], ...topics];
    const segments = topics.flatMap((topic, topicIndex) =>
      Array.from({ length: (topicIndex % 3) + 1 }, (_, segmentIndex) =>
        createTestSegment(
          `seg-${topic.id}-${segmentIndex}`,
          `この議題に関する代表的な長い日本語の発言です ${topicIndex + 1}-${segmentIndex + 1}`,
          topic.id,
          topicIndex * 10 + segmentIndex,
        ),
      ),
    );

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
      segments,
    });
    const rects = result.nodes.map((node) => {
      const data = node.data as GraphTopicNodeData;
      const width = data.kind === "root" ? 300 : data.kind === "utterance" ? 320 : 270;
      return { ...node.position, width, height: estimateTopicNodeHeight(data) };
    });

    assertNoOverlaps(rects);
  });

  it("always draws a root-to-topic branch, even when the stored parent edge is absent", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");
    const topic = createTestTopic("t1", "Topic 1");
    graph.nodes = [graph.nodes[0], topic];
    graph.edges = [createTopicEdge(graph.rootTopicId, topic.id, "parent")];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: graph.rootTopicId, target: topic.id, data: { relation: "parent" } });
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

  it("balances top-level topics across left and right branch columns", () => {
    const graph: MeetingGraph = createInitialMeetingGraph("Test Meeting");

    const topics = Array.from({ length: 6 }, (_, i) => createTestTopic(`t${i + 1}`, `Topic ${i + 1}`));
    graph.nodes = [graph.nodes[0], ...topics];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
    });

    const topicNodes = result.nodes.filter((n) => (n.data as GraphTopicNodeData).kind === "topic");

    const left = topicNodes.filter((node) => (node.data as GraphTopicNodeData).branchSide === "left");
    const right = topicNodes.filter((node) => (node.data as GraphTopicNodeData).branchSide === "right");

    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
    expect(new Set(left.map((node) => node.position.x)).size).toBe(1);
    expect(new Set(right.map((node) => node.position.x)).size).toBe(1);
    expect(left.every((node) => node.position.x < 0)).toBe(true);
    expect(right.every((node) => node.position.x > 0)).toBe(true);
    expect(left.slice(1).every((node, index) => node.position.y > left[index].position.y)).toBe(true);
    expect(right.slice(1).every((node, index) => node.position.y > right[index].position.y)).toBe(true);
  });

  it("balances by branch height when one topic has many utterances", () => {
    const graph = createInitialMeetingGraph("Test Meeting");
    const topics = [createTestTopic("t1", "発言の多い議題"), createTestTopic("t2", "短い議題"), createTestTopic("t3", "もう一つの短い議題")];
    graph.nodes = [graph.nodes[0], ...topics];
    const segments = Array.from({ length: 7 }, (_, index) =>
      createTestSegment(`seg-${index}`, `発言 ${index + 1}`, "t1", index + 1),
    );

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
      segments,
    });

    expect((result.nodes.find((node) => node.id === "t1")?.data as GraphTopicNodeData).branchSide).toBe("right");
    expect((result.nodes.find((node) => node.id === "t2")?.data as GraphTopicNodeData).branchSide).toBe("left");
    expect((result.nodes.find((node) => node.id === "t3")?.data as GraphTopicNodeData).branchSide).toBe("left");
  });

  it("places utterances outside their topic and connects direction-specific handles", () => {
    const graph = createInitialMeetingGraph("Test Meeting");
    const topics = [createTestTopic("t1", "右の議題"), createTestTopic("t2", "左の議題")];
    graph.nodes = [graph.nodes[0], ...topics];
    const segments = [
      createTestSegment("seg-right", "右側の発言です", "t1", 10),
      createTestSegment("seg-left", "左側の発言です", "t2", 20),
    ];

    const result = projectGraphToFlow({
      graph,
      currentTopicId: null,
      evidenceByTopicId: new Map(),
      segments,
    });
    const rightTopic = result.nodes.find((node) => node.id === "t1")!;
    const leftTopic = result.nodes.find((node) => node.id === "t2")!;
    const rightUtterance = result.nodes.find((node) => node.id === "utterance-t1-seg-right")!;
    const leftUtterance = result.nodes.find((node) => node.id === "utterance-t2-seg-left")!;
    const rightParent = result.edges.find((edge) => edge.target === "t1")!;
    const leftParent = result.edges.find((edge) => edge.target === "t2")!;

    expect(rightUtterance.position.x).toBeGreaterThan(rightTopic.position.x);
    expect(leftUtterance.position.x).toBeLessThan(leftTopic.position.x);
    expect(rightParent.sourceHandle).toBe("parent-right");
    expect(leftParent.sourceHandle).toBe("parent-left");
    expect(result.edges.filter((edge) => edge.data?.relation === "utterance").every((edge) => edge.sourceHandle === "utterances" && edge.targetHandle === "parent")).toBe(true);
  });

  it("adds matched utterances in chronological order and removes them when their topic is collapsed", () => {
    const graph = createInitialMeetingGraph("Test Meeting");
    const topic = createTestTopic("t1", "予算の見直し");
    graph.nodes = [graph.nodes[0], topic];
    const segments = [
      createTestSegment("seg-new", "次回までに予算案をまとめます", topic.id, 30),
      createTestSegment("seg-old", "今年の予算を確認しましょう", topic.id, 10),
    ];

    const expanded = projectGraphToFlow({
      graph,
      currentTopicId: topic.id,
      evidenceByTopicId: new Map(),
      segments,
    });
    const utterances = expanded.nodes.filter((node) => (node.data as GraphTopicNodeData).kind === "utterance");
    expect(utterances.map((node) => (node.data as GraphTopicNodeData).label)).toEqual([
      "今年の予算を確認しましょう",
      "次回までに予算案をまとめます",
    ]);
    expect(expanded.edges.filter((edge) => edge.data?.relation === "utterance")).toHaveLength(2);

    const collapsed = projectGraphToFlow({
      graph,
      currentTopicId: topic.id,
      evidenceByTopicId: new Map(),
      segments,
      collapsedTopicIds: new Set([topic.id]),
    });
    expect(collapsed.nodes.some((node) => (node.data as GraphTopicNodeData).kind === "utterance")).toBe(false);
    expect((collapsed.nodes.find((node) => node.id === topic.id)?.data as GraphTopicNodeData).isCollapsed).toBe(true);
  });
});
