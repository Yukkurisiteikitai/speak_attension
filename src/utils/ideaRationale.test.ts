import { describe, expect, it } from "vitest";
import { addIdeaUtterance, applyGrouping, beginGrouping, createInitialIdeaSessionState } from "./ideaSession";
import { ideaDecisionLabel, selectIdeaRationale } from "./ideaRationale";

describe("selectIdeaRationale", () => {
  it("keeps the keyword, its group, and all original utterances together", () => {
    let session = createInitialIdeaSessionState(1);
    session = addIdeaUtterance(session, "プッシュ通知を追加したい", "manual", 2);
    const keyword = session.keywords.find((candidate) => candidate.label === "プッシュ通知");
    if (!keyword) throw new Error("keyword was not extracted");
    session = beginGrouping(session);
    session = applyGrouping(session, [{ id: "notify", title: "通知", keywordIds: [keyword.id] }], "rules");

    expect(selectIdeaRationale(session, keyword.id)).toMatchObject({
      keyword: { label: "プッシュ通知", decision: "hold" },
      groupTitle: "通知",
      utterances: [{ text: "プッシュ通知を追加したい" }],
    });
    expect(selectIdeaRationale(session, "missing")).toBeNull();
    expect(ideaDecisionLabel("adopted")).toBe("採用");
  });
});
