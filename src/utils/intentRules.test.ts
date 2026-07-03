import { describe, expect, it } from "vitest";
import { detectUtteranceIntent } from "./intentRules";

describe("detectUtteranceIntent", () => {
  it("detects primary utterance intents", () => {
    expect(detectUtteranceIntent("どうしますか")).toBe("question");
    expect(detectUtteranceIntent("問題になりそう")).toBe("concern");
    expect(detectUtteranceIntent("後で見る")).toBe("todo");
    expect(detectUtteranceIntent("決めます")).toBe("decision");
    expect(detectUtteranceIntent("そうですね")).toBe("agreement");
    expect(detectUtteranceIntent("いや違う")).toBe("correction");
    expect(detectUtteranceIntent("話を戻すと")).toBe("switch_topic");
  });
});
