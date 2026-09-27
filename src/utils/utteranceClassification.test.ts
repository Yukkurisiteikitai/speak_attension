import { describe, expect, it } from "vitest";
import { classifyUtterance } from "./utteranceClassification";

describe("classifyUtterance: regression fixtures from real meeting speech", () => {
  it("Case A: topic transition is not a proposal or action", () => {
    const result = classifyUtterance("じゃあスライドの構成について会議を始める");
    expect(result.semanticRole).toBe("topic");
    expect(result.discourseAct).toBe("topic_start");
    expect(result.commitment).toBe("none");
  });

  it("Case B: background/context is not confirmed as a problem", () => {
    const result = classifyUtterance("スライドの構成のベースはまず決まっていて、問題、解決へのプロセス、解決策のデモ、今後");
    expect(["context", "agenda_item"]).toContain(result.semanticRole);
    expect(result.semanticRole).not.toBe("problem");
    expect(result.commitment).not.toBe("decided");
    expect(result.commitment).not.toBe("committed");
  });

  it("Case C: personal consideration is not a committed action", () => {
    const result = classifyUtterance("個人的に考えているのが1、私は今までどんな情報があってどんな優先順位をつけて行動を");
    expect(result.semanticRole).toBe("option");
    expect(result.commitment).toBe("considered");
    expect(result.commitment).not.toBe("committed");
    expect(result.semanticRole).not.toBe("action");
  });

  it("Case D: a short reply does not add a strong semantic node", () => {
    const result = classifyUtterance("ありませんよね");
    expect(result.semanticRole).toBe("acknowledgement");
    expect(result.commitment).toBe("none");
  });

  it("Case E: a sentence merely starting with だから is not confirmed as a reason", () => {
    const result = classifyUtterance("だからこそ私のサービスでは、リアルタイムに判断に必要な情報を収集しながら");
    expect(result.semanticRole).not.toBe("reason");
  });
});

describe("classifyUtterance: option vs proposal vs decision vs action", () => {
  it("enumerating options is 'option', not 'proposal'", () => {
    const result = classifyUtterance("方法としてA、B、Cがあります");
    expect(result.semanticRole).toBe("option");
    expect(result.discourseAct).toBe("enumerate");
    expect(result.commitment).toBe("mentioned");
  });

  it("advocating for one option is 'proposal', not merely 'option'", () => {
    const result = classifyUtterance("私はBが良いと思います");
    expect(result.semanticRole).toBe("proposal");
    expect(result.commitment).toBe("proposed");
  });

  it("'したらどうでしょう' is also a proposal", () => {
    const result = classifyUtterance("Aにしたらどうでしょう");
    expect(result.semanticRole).toBe("proposal");
    expect(result.commitment).toBe("proposed");
  });

  it("a proposal is never a decision", () => {
    const result = classifyUtterance("私はAで進めるのがいいと思います");
    expect(result.semanticRole).not.toBe("decision");
    expect(result.commitment).not.toBe("decided");
  });

  it("an explicit choice is 'decision'", () => {
    const result = classifyUtterance("ではAに決めます");
    expect(result.semanticRole).toBe("decision");
    expect(result.discourseAct).toBe("decide");
    expect(result.commitment).toBe("decided");
  });

  it("a grounded commitment with owner and deadline is 'action'", () => {
    const result = classifyUtterance("私が金曜日までにAをやります");
    expect(result.semanticRole).toBe("action");
    expect(result.commitment).toBe("committed");
    expect(result.owner).toBe("私");
    expect(result.deadline).toContain("金曜日");
  });

  it("'Aをやりたい' alone is not an action", () => {
    const result = classifyUtterance("Aをやりたい");
    expect(result.semanticRole).not.toBe("action");
    expect(result.commitment).not.toBe("committed");
  });

  it("'Aを考えています' alone is not an action", () => {
    const result = classifyUtterance("Aを考えています");
    expect(result.semanticRole).not.toBe("action");
    expect(result.commitment).not.toBe("committed");
  });

  it("an execution verb with no owner or deadline is downgraded, not confirmed as action", () => {
    const result = classifyUtterance("対応します");
    expect(result.semanticRole).not.toBe("action");
    expect(result.commitment).not.toBe("committed");
  });
});

describe("classifyUtterance: agenda item vs action", () => {
  it("an agenda list of topics is 'agenda_item', not action", () => {
    const result = classifyUtterance("今日整理したいことは3つ、スライド作成、コーディング、リファクタリングです");
    expect(result.semanticRole).toBe("agenda_item");
    expect(result.semanticRole).not.toBe("action");
  });
});

describe("classifyUtterance: unknown fallback", () => {
  it("does not force a strong role on an ambiguous long statement", () => {
    const result = classifyUtterance("えーっとその辺はまたあとで詳しく話すとして今はいったん置いておきましょうか");
    expect(["context", "other", "acknowledgement"]).toContain(result.semanticRole);
    expect(result.commitment).not.toBe("decided");
    expect(result.commitment).not.toBe("committed");
  });

  it("a very short ambiguous utterance is treated as acknowledgement, not forced into a role", () => {
    const result = classifyUtterance("そうですね");
    expect(result.semanticRole).toBe("acknowledgement");
  });
});

describe("classifyUtterance: questions", () => {
  it("recognizes a plain wh-question ending in か", () => {
    const result = classifyUtterance("このステップが完了することは何を意味するか");
    expect(result.semanticRole).toBe("question");
    expect(result.discourseAct).toBe("ask");
  });
});
