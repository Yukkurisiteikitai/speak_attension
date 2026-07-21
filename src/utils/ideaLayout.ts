import type { IdeaGroup, IdeaKeyword } from "./ideaSession";
import { estimateTextWidth } from "./textMetrics";

export type IdeaNodePosition = { x: number; y: number };
export type IdeaNodeSize = { width: number; height: number };
export type IdeaNodeKind = "center" | "group" | "keyword";

// .idea-node CSS box model (styles.css): border + padding per kind, used to
// turn a label string into a conservative (>= real rendered size) footprint
// so layout math can guarantee non-overlap without measuring the live DOM.
const FONT_SIZE: Record<IdeaNodeKind, number> = { center: 15, group: 13, keyword: 13 };
const PADDING_X: Record<IdeaNodeKind, number> = { center: 40, group: 28, keyword: 28 };
const BORDER_X: Record<IdeaNodeKind, number> = { center: 3, group: 4, keyword: 3 };
const HEIGHT: Record<IdeaNodeKind, number> = { center: 48, group: 40, keyword: 40 };
const BADGE_GAP = 8;

// Conservative (over-)estimate of a rendered .idea-node's box, since layout
// only has the label text available, not the live DOM.
export function estimateIdeaNodeSize(
  label: string,
  kind: IdeaNodeKind,
  opts: { mentionCount?: number } = {},
): IdeaNodeSize {
  let width = estimateTextWidth(label, FONT_SIZE[kind]) + PADDING_X[kind] + BORDER_X[kind];

  if (kind === "keyword") {
    if ((opts.mentionCount ?? 1) > 1) {
      width += BADGE_GAP + estimateTextWidth(`×${opts.mentionCount}`, 11);
    }
    // Always reserve the decision badge so changing 採用・保留・却下 never
    // shifts the node's footprint mid-session (all labels are two kanji).
    width += BADGE_GAP + estimateTextWidth("採用", 10) + 16;
  }

  return { width: Math.ceil(width), height: HEIGHT[kind] };
}

function halfExtentOf(size: IdeaNodeSize): number {
  return Math.hypot(size.width, size.height) / 2;
}

export type RadialLayout = {
  keywordPositions: Map<string, IdeaNodePosition>;
  centerPosition: IdeaNodePosition;
};

const SPIRAL_START_MARGIN = 56;
const SPIRAL_NODE_MARGIN = 18;
const SPIRAL_Y_SQUASH = 0.72;
const SPIRAL_ANGLE_PROBE = (Math.PI * 2) / 180; // 2° search granularity when nudging past a collision
const SPIRAL_RADIUS_GROWTH_PER_RADIAN = 11; // ~radius grows by one node-height per full revolution
const SPIRAL_MAX_PROBES = 4000; // safety valve; radius growth alone guarantees termination well before this

type SpiralRect = { x: number; y: number; width: number; height: number };

function spiralRect(angle: number, radius: number, size: IdeaNodeSize): SpiralRect {
  const px = Math.cos(angle) * radius;
  const py = Math.sin(angle) * radius * SPIRAL_Y_SQUASH;
  return { x: px - size.width / 2, y: py - size.height / 2, width: size.width, height: size.height };
}

function rectsClear(a: SpiralRect, b: SpiralRect, margin: number): boolean {
  return (
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

// 発散フェーズ: 中心から連続的な渦を描いて外へ置いていく。発言順がそのまま
// 内側→外側になるので、会話の流れが地層のように見える。角度の刻み幅は
// まず直前ノードの実寸から見積もり、その候補位置を既に置いた全ノード(と
// 中心ノード)に対して実際に検証してから確定する。楕円状に圧縮した渦では
// リング境界や一周目の継ぎ目で見積もりだけでは足りないケースがあるため、
// 衝突が見つかった分だけ角度をわずかに進め半径もじわりと広げて再検証する。
export function radialPositions(keywords: IdeaKeyword[], centerLabel: string): RadialLayout {
  const positions = new Map<string, IdeaNodePosition>();
  const centerSize = estimateIdeaNodeSize(centerLabel, "center");
  const centerPosition: IdeaNodePosition = {
    x: Math.round(-centerSize.width / 2),
    y: Math.round(-centerSize.height / 2),
  };

  const ordered = [...keywords].sort((left, right) => left.firstMentionedAt - right.firstMentionedAt);
  if (ordered.length === 0) return { keywordPositions: positions, centerPosition };

  const placed: SpiralRect[] = [
    { x: centerPosition.x, y: centerPosition.y, width: centerSize.width, height: centerSize.height },
  ];

  let angle = 0;
  let radius = centerSize.width / 2 + SPIRAL_START_MARGIN;

  for (const keyword of ordered) {
    const size = estimateIdeaNodeSize(keyword.label, "keyword", { mentionCount: keyword.mentionCount });

    let candidate = spiralRect(angle, radius, size);
    let guard = 0;
    while (placed.some((rect) => !rectsClear(candidate, rect, SPIRAL_NODE_MARGIN)) && guard < SPIRAL_MAX_PROBES) {
      angle += SPIRAL_ANGLE_PROBE;
      radius += SPIRAL_ANGLE_PROBE * SPIRAL_RADIUS_GROWTH_PER_RADIAN;
      candidate = spiralRect(angle, radius, size);
      guard += 1;
    }

    positions.set(keyword.id, { x: Math.round(candidate.x), y: Math.round(candidate.y) });
    placed.push(candidate);

    const footprint = halfExtentOf(size) * 2 + SPIRAL_NODE_MARGIN;
    angle += Math.max(SPIRAL_ANGLE_PROBE, footprint / Math.max(radius * SPIRAL_Y_SQUASH, 1));
  }

  return { keywordPositions: positions, centerPosition };
}

export type MindmapLayout = {
  groupPositions: Map<string, IdeaNodePosition>;
  keywordPositions: Map<string, IdeaNodePosition>;
  centerPosition: IdeaNodePosition;
};

const MINDMAP_LINK_GAP = 140;
const MINDMAP_KEYWORD_GAP = 90;
const MINDMAP_ROW_GAP = 14;
const MINDMAP_GROUP_GAP = 40;
const UNGROUPED_GROUP_ID = "__ungrouped__";

type SideRow = { y: number; width: number };
type SideLayout = {
  groupRows: Map<string, SideRow>;
  keywordRows: Map<string, SideRow>;
  maxGroupWidth: number;
  totalHeight: number;
};

// 1サイド分をトップダウンに積む簡易 tidy-tree。各グループはノード実寸から
// 見積もったキーワード行の合計高さ(または自身の高さ、大きい方)を専有し、
// 行間・グループ間に固定ギャップを入れることで重なりを防ぐ。
function layoutSideRows(sideGroups: IdeaGroup[], keywordById: Map<string, IdeaKeyword>): SideLayout {
  const groupRows = new Map<string, SideRow>();
  const keywordRows = new Map<string, SideRow>();
  let maxGroupWidth = 0;
  let cursorY = 0;

  sideGroups.forEach((group, index) => {
    const groupSize = estimateIdeaNodeSize(group.title, "group");
    maxGroupWidth = Math.max(maxGroupWidth, groupSize.width);

    const members = group.keywordIds
      .map((id) => keywordById.get(id))
      .filter((keyword): keyword is IdeaKeyword => Boolean(keyword))
      .map((keyword) => ({
        keyword,
        size: estimateIdeaNodeSize(keyword.label, "keyword", { mentionCount: keyword.mentionCount }),
      }));

    const rowsHeight = members.reduce(
      (sum, member, memberIndex) => sum + member.size.height + (memberIndex > 0 ? MINDMAP_ROW_GAP : 0),
      0,
    );
    const blockHeight = Math.max(groupSize.height, rowsHeight);

    let rowCursor = cursorY + (blockHeight - rowsHeight) / 2;
    for (const member of members) {
      keywordRows.set(member.keyword.id, { y: rowCursor, width: member.size.width });
      rowCursor += member.size.height + MINDMAP_ROW_GAP;
    }

    groupRows.set(group.id, { y: cursorY + (blockHeight - groupSize.height) / 2, width: groupSize.width });

    cursorY += blockHeight + (index < sideGroups.length - 1 ? MINDMAP_GROUP_GAP : 0);
  });

  return { groupRows, keywordRows, maxGroupWidth, totalHeight: cursorY };
}

// 収束フェーズ: 中心から右へ「グループ → キーワード」と進む一方向の
// 階層配置。同じグループのキーワードを連続した縦ブロックにまとめることで、
// 左右へ枝分かれしたときのように別グループ同士が一続きに見えることを防ぐ。
export function mindmapPositions(groups: IdeaGroup[], keywords: IdeaKeyword[], centerLabel: string): MindmapLayout {
  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const groupedIds = new Set(groups.flatMap((group) => group.keywordIds));
  const orphanIds = keywords.filter((keyword) => !groupedIds.has(keyword.id)).map((keyword) => keyword.id);

  const effectiveGroups =
    orphanIds.length > 0 ? [...groups, { id: UNGROUPED_GROUP_ID, title: "その他", keywordIds: orphanIds }] : groups;

  const centerSize = estimateIdeaNodeSize(centerLabel, "center");
  const groupPositions = new Map<string, IdeaNodePosition>();
  const keywordPositions = new Map<string, IdeaNodePosition>();

  const placement = layoutSideRows(effectiveGroups, keywordById);
  const yOffset = -placement.totalHeight / 2;
  const groupColumnX = centerSize.width / 2 + MINDMAP_LINK_GAP;
  const keywordColumnX = groupColumnX + placement.maxGroupWidth + MINDMAP_KEYWORD_GAP;

  for (const [groupId, row] of placement.groupRows) {
    groupPositions.set(groupId, { x: Math.round(groupColumnX), y: Math.round(row.y + yOffset) });
  }
  for (const [keywordId, row] of placement.keywordRows) {
    keywordPositions.set(keywordId, { x: Math.round(keywordColumnX), y: Math.round(row.y + yOffset) });
  }

  return {
    groupPositions,
    keywordPositions,
    centerPosition: { x: Math.round(-centerSize.width / 2), y: Math.round(-centerSize.height / 2) },
  };
}
