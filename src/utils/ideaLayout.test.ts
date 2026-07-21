import { describe, expect, it } from "vitest";
import { estimateIdeaNodeSize, mindmapPositions, radialPositions } from "./ideaLayout";
import type { IdeaGroup, IdeaKeyword } from "./ideaSession";

function keyword(id: string, label: string, overrides: Partial<IdeaKeyword> = {}): IdeaKeyword {
  return {
    id,
    label,
    normalized: label.toLocaleLowerCase("ja-JP"),
    mentionCount: 1,
    utteranceIds: [`utt-${id}`],
    firstMentionedAt: 0,
    groupId: null,
    decision: "hold",
    ...overrides,
  };
}

function group(id: string, title: string, keywordIds: string[]): IdeaGroup {
  return { id, title, keywordIds };
}

type Rect = { x: number; y: number; width: number; height: number };

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertNoOverlaps(rects: Rect[]) {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      expect(rectsOverlap(rects[i], rects[j])).toBe(false);
    }
  }
}

const LONG_JP_LABEL = "オフラインでも動く高精度な音声認識と自動要約機能";
const LONG_GROUP_TITLE = "エンゲージメントとリテンションを高める通知設計 系";

describe("estimateIdeaNodeSize", () => {
  it("grows wider for longer labels", () => {
    const short = estimateIdeaNodeSize("A", "keyword");
    const long = estimateIdeaNodeSize(LONG_JP_LABEL, "keyword");
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("reserves the decision badge width regardless of mentionCount", () => {
    const singleMention = estimateIdeaNodeSize("通知", "keyword", { mentionCount: 1 });
    const mentioned = estimateIdeaNodeSize("通知", "keyword", { mentionCount: 5 });
    expect(mentioned.width).toBeGreaterThan(singleMention.width);
  });
});

describe("mindmapPositions", () => {
  const keywords: IdeaKeyword[] = [
    keyword("k1", "通知"),
    keyword("k2", "バッジ", { mentionCount: 3 }),
    keyword("k3", LONG_JP_LABEL),
    keyword("k4", "push"),
    keyword("k5", "料金プラン", { mentionCount: 5 }),
    keyword("k6", "オンボーディング"),
    keyword("k7", "A"),
    keyword("k8", "オフライン対応"),
    keyword("k9", "キャッシュ戦略"),
    keyword("k10", "検索"),
  ];
  const groups: IdeaGroup[] = [
    group("g1", "通知系", ["k1", "k2", "k3"]),
    group("g2", LONG_GROUP_TITLE, ["k4", "k5"]),
    group("g3", "オンボーディング系", ["k6", "k7"]),
    group("g4", "パフォーマンス系", ["k8", "k9"]),
  ];
  const title = "アイデア出しセッション: 新機能ブレスト";

  function collectRects(
    layout: ReturnType<typeof mindmapPositions>,
    forGroups: IdeaGroup[],
    forKeywords: IdeaKeyword[],
  ): Rect[] {
    const rects: Rect[] = [{ ...layout.centerPosition, ...estimateIdeaNodeSize(title, "center") }];
    for (const g of forGroups) {
      const pos = layout.groupPositions.get(g.id);
      if (!pos) continue;
      rects.push({ ...pos, ...estimateIdeaNodeSize(g.title, "group") });
    }
    for (const kw of forKeywords) {
      const pos = layout.keywordPositions.get(kw.id);
      if (!pos) continue;
      rects.push({ ...pos, ...estimateIdeaNodeSize(kw.label, "keyword", { mentionCount: kw.mentionCount }) });
    }
    return rects;
  }

  it("never overlaps any pair of node rectangles", () => {
    const layout = mindmapPositions(groups, keywords, title);
    assertNoOverlaps(collectRects(layout, groups, keywords));
  });

  it("places every group and keyword to the right in hierarchy order", () => {
    const layout = mindmapPositions(groups, keywords, title);
    const centerSize = estimateIdeaNodeSize(title, "center");
    const centerRight = layout.centerPosition.x + centerSize.width;

    for (const currentGroup of groups) {
      const groupPos = layout.groupPositions.get(currentGroup.id)!;
      const groupSize = estimateIdeaNodeSize(currentGroup.title, "group");
      expect(groupPos.x).toBeGreaterThanOrEqual(centerRight);

      for (const keywordId of currentGroup.keywordIds) {
        const keywordPos = layout.keywordPositions.get(keywordId)!;
        expect(keywordPos.x).toBeGreaterThanOrEqual(groupPos.x + groupSize.width);
      }
    }
  });

  it("keeps each group's keyword rows together and preserves group order", () => {
    const layout = mindmapPositions(groups, keywords, title);
    const ranges = groups.map((currentGroup) => {
      const rows = currentGroup.keywordIds.map((id) => layout.keywordPositions.get(id)!.y);
      return { min: Math.min(...rows), max: Math.max(...rows) };
    });

    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index - 1].max).toBeLessThan(ranges[index].min);
    }
  });

  it("is deterministic for the same input", () => {
    const first = mindmapPositions(groups, keywords, title);
    const second = mindmapPositions(groups, keywords, title);
    expect([...first.groupPositions.entries()]).toEqual([...second.groupPositions.entries()]);
    expect([...first.keywordPositions.entries()]).toEqual([...second.keywordPositions.entries()]);
    expect(first.centerPosition).toEqual(second.centerPosition);
  });

  it("places keywords with no group into a virtual group instead of the origin", () => {
    const orphan = keyword("k-orphan", "浮いたキーワード");
    const allKeywords = [...keywords, orphan];
    const layout = mindmapPositions(groups, allKeywords, title);

    const pos = layout.keywordPositions.get("k-orphan");
    expect(pos).toBeDefined();
    expect(pos).not.toEqual({ x: 0, y: 0 });
    assertNoOverlaps(collectRects(layout, groups, allKeywords));
  });
});

describe("radialPositions", () => {
  const title = "アイデア出しセッション";
  const labelPool = [
    "通知",
    "バッジ",
    LONG_JP_LABEL,
    "push",
    "料金プラン",
    "オンボーディング",
    "A",
    "オフライン対応",
    "キャッシュ戦略",
    "検索",
    "ダークモード",
    "共有機能",
    "エクスポート",
    "インポート",
    "同期",
    "履歴",
    "ショートカット",
    "テーマ",
    "アクセシビリティ",
    "多言語対応",
  ];

  function manyKeywords(count: number): IdeaKeyword[] {
    return Array.from({ length: count }, (_, i) =>
      keyword(`k${i}`, labelPool[i % labelPool.length] + (i >= labelPool.length ? String(i) : ""), {
        firstMentionedAt: i,
        mentionCount: (i % 4) + 1,
      }),
    );
  }

  function collectRects(forKeywords: IdeaKeyword[], layout: ReturnType<typeof radialPositions>): Rect[] {
    const rects: Rect[] = [{ ...layout.centerPosition, ...estimateIdeaNodeSize(title, "center") }];
    for (const kw of forKeywords) {
      const pos = layout.keywordPositions.get(kw.id);
      expect(pos).toBeDefined();
      rects.push({ ...pos!, ...estimateIdeaNodeSize(kw.label, "keyword", { mentionCount: kw.mentionCount }) });
    }
    return rects;
  }

  it("never overlaps for a small set of keywords (single ring)", () => {
    const keywords = manyKeywords(6);
    const layout = radialPositions(keywords, title);
    assertNoOverlaps(collectRects(keywords, layout));
  });

  it("never overlaps once multiple spiral rings are needed", () => {
    const keywords = manyKeywords(40);
    const layout = radialPositions(keywords, title);
    assertNoOverlaps(collectRects(keywords, layout));
  });

  it("never overlaps with a mix of very long and very short labels", () => {
    const keywords = [
      keyword("a", LONG_JP_LABEL, { firstMentionedAt: 0 }),
      keyword("b", "A", { firstMentionedAt: 1 }),
      keyword("c", "オフラインでも動く高精度な音声認識と自動要約機能その2", { firstMentionedAt: 2 }),
      keyword("d", "B", { firstMentionedAt: 3 }),
      keyword("e", "料金プランの再設計と段階的な移行計画について", { firstMentionedAt: 4 }),
    ];
    const layout = radialPositions(keywords, title);
    assertNoOverlaps(collectRects(keywords, layout));
  });

  it("is deterministic for the same input", () => {
    const keywords = manyKeywords(15);
    const first = radialPositions(keywords, title);
    const second = radialPositions(keywords, title);
    expect([...first.keywordPositions.entries()]).toEqual([...second.keywordPositions.entries()]);
    expect(first.centerPosition).toEqual(second.centerPosition);
  });

  it("places earlier-mentioned keywords closer to the center than later ones", () => {
    const keywords = manyKeywords(20);
    const layout = radialPositions(keywords, title);

    const distanceOf = (kw: IdeaKeyword) => {
      const pos = layout.keywordPositions.get(kw.id)!;
      const size = estimateIdeaNodeSize(kw.label, "keyword", { mentionCount: kw.mentionCount });
      const cx = pos.x + size.width / 2;
      const cy = pos.y + size.height / 2;
      return Math.hypot(cx, cy);
    };

    expect(distanceOf(keywords[0])).toBeLessThan(distanceOf(keywords[keywords.length - 1]));
  });
});
