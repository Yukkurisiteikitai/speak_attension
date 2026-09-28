import { describe, expect, it } from "vitest";
import { detectAct, detectCommitment, detectEpistemic, detectRole, detectScope, extractActionDetails, parseAxes } from "./parseAxes";

describe("detectScope", () => {
  it("reads agenda-setting as meeting_process even when it names a deliverable", () => {
    // Invariant I4 depends on this: 「今日は…決めます」 is agenda-setting, so it
    // can never reach decisions or actions.
    expect(detectScope("今日はスライドの構成について決めます")).toBe("meeting_process");
    expect(detectScope("今日は今四半期のロードマップを確定します")).toBe("meeting_process");
    expect(detectScope("今日整理したいことは3つ、スライド作成、コーディングです")).toBe("meeting_process");
    expect(detectScope("本日の朝会を始めます")).toBe("meeting_process");
    expect(detectScope("話を戻すと、Wi-Fi負荷の件ですが")).toBe("meeting_process");
  });

  it("reads a statement about the deliverable as artifact_content", () => {
    expect(detectScope("スライドの構成のベースはまず決まっていて")).toBe("artifact_content");
  });

  it("reads a substantive statement with no marker as subject_matter", () => {
    expect(detectScope("対戦ゲーム形式を採用します")).toBe("subject_matter");
  });

  it("does not guess a scope for filler or a very short reply", () => {
    expect(detectScope("そうですね")).toBe("unknown");
    expect(detectScope("")).toBe("unknown");
  });
});

describe("detectAct / detectRole / detectCommitment", () => {
  it("separates enumerating options from advocating one", () => {
    expect(detectAct("方法としてA、B、Cがあります")).toBe("enumerate");
    expect(detectRole("方法としてA、B、Cがあります")).toBe("option");
    expect(detectCommitment("方法としてA、B、Cがあります")).toBe("mentioned");
  });

  it("reads a volitional form as a proposal, not a decision", () => {
    expect(detectAct("対戦ゲーム形式で進めましょう")).toBe("suggest");
    expect(detectCommitment("対戦ゲーム形式で進めましょう")).toBe("proposed");
    expect(detectCommitment("対戦ゲーム形式で進めましょう")).not.toBe("decided");
  });

  it("reads an explicit closing form as decided", () => {
    expect(detectAct("対戦ゲーム形式を採用します")).toBe("decide");
    expect(detectCommitment("対戦ゲーム形式を採用します")).toBe("decided");
    expect(detectCommitment("レイテンシー削減を優先で進めることにします")).toBe("decided");
  });

  it("does not read a bare ます ending as decided", () => {
    // This is the progress report that legacy promotes to a confirmed decision.
    expect(detectCommitment("パフォーマンステストは本日中に完了します")).not.toBe("decided");
    expect(detectAct("パフォーマンステストは本日中に完了します")).not.toBe("decide");
  });

  it("lets a stated deliberation cap the commitment", () => {
    // 「まだ検討中です。青チームで検証します」 must not come out decided.
    expect(detectCommitment("そこはまだ検討中です。青チームで検証します")).toBe("considered");
    expect(detectCommitment("個人的に考えているのが1、私は今までどんな情報が")).toBe("considered");
  });

  it("distinguishes support from opposition", () => {
    expect(detectAct("それでいきましょう")).toBe("advocate");
    expect(detectCommitment("それでいきましょう")).toBe("accepted");
    expect(detectAct("それは反対です。コストが見合いません")).toBe("oppose");
    expect(detectCommitment("それは反対です。コストが見合いません")).toBe("rejected");
  });

  it("recognizes a deferral", () => {
    expect(detectAct("ランキング機能については、保留にしておきましょう")).toBe("defer");
    expect(detectCommitment("ランキング機能については、保留にしておきましょう")).toBe("deferred");
  });

  it("recognizes a wh-question ending in か", () => {
    expect(detectAct("このステップが完了することは何を意味するか")).toBe("ask");
    expect(detectRole("このステップが完了することは何を意味するか")).toBe("question");
    expect(detectCommitment("このステップが完了することは何を意味するか")).toBe("none");
  });

  it("treats filler as an acknowledgement with no commitment", () => {
    expect(detectRole("そうですね")).toBe("acknowledgement");
    expect(detectCommitment("そうですね")).toBe("none");
  });
});

describe("axis independence (invariant I11)", () => {
  it("a decision role does not imply a decided commitment", () => {
    const axes = parseAxes("対戦ゲーム形式の話です");
    expect(axes.role).not.toBe("decision");
    // And where the role IS decision, commitment is decided only because the
    // text carries a closing marker -- not because of the role.
    const decided = parseAxes("対戦ゲーム形式を採用します");
    expect(decided.role).toBe("decision");
    expect(decided.commitment).toBe("decided");
    const considered = parseAxes("対戦ゲーム形式を採用するか検討しています");
    expect(considered.commitment).toBe("considered");
  });

  it("always reports rule provenance from the realtime parser", () => {
    expect(parseAxes("対戦ゲーム形式を採用します").provenance).toBe("rule");
  });
});

describe("detectEpistemic", () => {
  it("is explicit only when a marker is present", () => {
    expect(detectEpistemic("対戦ゲーム形式を採用します")).toBe("explicit");
    expect(detectEpistemic("来場者が少ないときの集客が難しい状況が続いています")).toBe("inferred");
  });

  it("is ambiguous for an unresolved leading reference", () => {
    // Blocks promotion via I8 rather than guessing what それ refers to.
    expect(detectEpistemic("それで進めましょう")).toBe("ambiguous");
    expect(detectEpistemic("これを採用します")).toBe("ambiguous");
  });

  it("is ambiguous for filler and very short replies", () => {
    expect(detectEpistemic("そうですね")).toBe("ambiguous");
    expect(detectEpistemic("")).toBe("ambiguous");
  });
});

describe("extractActionDetails", () => {
  it("extracts an owner anchored on the honorific, not on the clause start", () => {
    // A holdout run on demo/ produced 「移行の検証は佐藤」 before the name was
    // anchored on さん and particles were excluded.
    expect(extractActionDetails("データベース移行の検証は佐藤さんが11月15日までにやります").owner).toBe("佐藤");
    expect(extractActionDetails("鈴木さんがプロトタイプを来週金曜日までに作成します").owner).toBe("鈴木");
  });

  it("extracts a bare subject when there is no honorific", () => {
    expect(extractActionDetails("私が金曜日までにやります").owner).toBe("私");
  });

  it("returns no owner for two people joined by と, rather than picking one", () => {
    const details = extractActionDetails("田中さんと鈴木さんが対応します");
    expect(details.owner).toBeNull();
  });

  it("extracts weekday and dated deadlines", () => {
    expect(extractActionDetails("鈴木さんが来週金曜日までに作成します").deadline).toContain("金曜日");
    expect(extractActionDetails("佐藤さんが11月15日までにやります").deadline).toContain("11月15日");
    expect(extractActionDetails("今すぐ対応します").deadline).toBe("即時");
  });

  it("never mistakes 今まで for a deadline", () => {
    // The legacy fix for this was applied to only one of its two copies, which
    // is why conversationTree still reads this as an action.
    expect(extractActionDetails("私は今までどんな情報があって").deadline).toBeNull();
    expect(extractActionDetails("今まで対応していません").deadline).toBeNull();
  });
});
