import type { IdeaKeyword, IdeaSessionState, IdeaUtterance } from "./ideaSession";

export type IdeaRationale = {
  keyword: IdeaKeyword;
  groupTitle: string | null;
  utterances: IdeaUtterance[];
};

// This is intentionally a read-only projection of the brainstorm state. It
// lets the capture and grouping screens explain an idea without changing its
// adoption decision or the underlying map.
export function selectIdeaRationale(session: IdeaSessionState, keywordId: string): IdeaRationale | null {
  const keyword = session.keywords.find((candidate) => candidate.id === keywordId);
  if (!keyword) return null;

  const utterancesById = new Map(session.utterances.map((utterance) => [utterance.id, utterance]));
  const groupTitle = keyword.groupId
    ? session.groups.find((group) => group.id === keyword.groupId)?.title ?? null
    : null;

  return {
    keyword,
    groupTitle,
    utterances: keyword.utteranceIds
      .map((utteranceId) => utterancesById.get(utteranceId))
      .filter((utterance): utterance is IdeaUtterance => Boolean(utterance)),
  };
}

export function ideaDecisionLabel(decision: IdeaKeyword["decision"]): string {
  return decision === "adopted" ? "採用" : decision === "rejected" ? "却下" : "保留";
}
