import type { IdeaGroup, IdeaKeyword } from "./ideaSession";

export type IdeaNodePosition = { x: number; y: number };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// 発散フェーズ: 中心から金角スパイラルで外へ置いていく。発言順がそのまま
// 内側→外側になるので、会話の流れが地層のように見える。
export function radialPositions(keywords: IdeaKeyword[]): Map<string, IdeaNodePosition> {
  const positions = new Map<string, IdeaNodePosition>();
  const ordered = [...keywords].sort((left, right) => left.firstMentionedAt - right.firstMentionedAt);

  ordered.forEach((keyword, index) => {
    const angle = index * GOLDEN_ANGLE;
    const radius = 170 + 46 * Math.sqrt(index);
    positions.set(keyword.id, {
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius * 0.72),
    });
  });

  return positions;
}

export type MindmapLayout = {
  groupPositions: Map<string, IdeaNodePosition>;
  keywordPositions: Map<string, IdeaNodePosition>;
};

const GROUP_COLUMN_X = 340;
const KEYWORD_COLUMN_X = 640;
const KEYWORD_ROW_HEIGHT = 68;
const GROUP_GAP = 40;

// 収束フェーズ: 中心の左右にグループ列、さらに外側にキーワード列を置く
// 古典的マインドマップ配置。左右交互に振り分けて縦に積む。
export function mindmapPositions(groups: IdeaGroup[]): MindmapLayout {
  const groupPositions = new Map<string, IdeaNodePosition>();
  const keywordPositions = new Map<string, IdeaNodePosition>();

  const sides: Array<{ direction: 1 | -1; groups: IdeaGroup[] }> = [
    { direction: 1, groups: [] },
    { direction: -1, groups: [] },
  ];
  groups.forEach((group, index) => {
    sides[index % 2].groups.push(group);
  });

  for (const side of sides) {
    const totalRows = side.groups.reduce((sum, group) => sum + group.keywordIds.length, 0);
    const totalHeight = totalRows * KEYWORD_ROW_HEIGHT + Math.max(0, side.groups.length - 1) * GROUP_GAP;
    let cursorY = -totalHeight / 2;

    for (const group of side.groups) {
      const blockHeight = group.keywordIds.length * KEYWORD_ROW_HEIGHT;
      groupPositions.set(group.id, {
        x: side.direction * GROUP_COLUMN_X,
        y: Math.round(cursorY + blockHeight / 2),
      });

      group.keywordIds.forEach((keywordId, rowIndex) => {
        keywordPositions.set(keywordId, {
          x: side.direction * KEYWORD_COLUMN_X,
          y: Math.round(cursorY + rowIndex * KEYWORD_ROW_HEIGHT + KEYWORD_ROW_HEIGHT / 2),
        });
      });

      cursorY += blockHeight + GROUP_GAP;
    }
  }

  return { groupPositions, keywordPositions };
}
