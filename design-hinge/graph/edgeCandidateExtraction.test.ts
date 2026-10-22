import { describe, expect, it } from "vitest";
import { extractEdgeCandidates } from "./edgeCandidateExtraction";

describe("extractEdgeCandidates", () => {
  it("detects a causes relation via ので", () => {
    const candidates = extractEdgeCandidates("容疑者になったので、一次情報が不足する");
    expect(candidates).toEqual([
      expect.objectContaining({ sourceLabel: "容疑者になった", targetLabel: "一次情報が不足", relation: "causes" }),
    ]);
  });

  it("detects a blocks relation via がなければ…できない", () => {
    const candidates = extractEdgeCandidates("証拠がなければ告発できない");
    expect(candidates).toEqual([
      expect.objectContaining({ sourceLabel: "証拠", targetLabel: "告発", relation: "blocks" }),
    ]);
  });

  it("detects an enables relation via があれば…できる", () => {
    const candidates = extractEdgeCandidates("証言があれば証明できる");
    expect(candidates).toEqual([
      expect.objectContaining({ sourceLabel: "証言", targetLabel: "証明", relation: "enables" }),
    ]);
  });

  it("detects a depends_on relation via には…が必要", () => {
    const candidates = extractEdgeCandidates("説得には証拠が必要");
    expect(candidates).toEqual([
      expect.objectContaining({ sourceLabel: "説得", targetLabel: "証拠", relation: "depends_on" }),
    ]);
  });

  it("detects a contradicts relation via と思ったが", () => {
    const candidates = extractEdgeCandidates("正直に話そうと思ったが、嘘をついた");
    expect(candidates).toEqual([
      expect.objectContaining({ sourceLabel: "正直に話そう", targetLabel: "嘘をついた", relation: "contradicts" }),
    ]);
  });

  it("detects a transforms relation via を…に変える", () => {
    const candidates = extractEdgeCandidates("主人公を容疑者に変えた");
    expect(candidates).toEqual([
      expect.objectContaining({ sourceLabel: "主人公", targetLabel: "容疑者", relation: "transforms" }),
    ]);
  });

  it("returns no candidates for plain unrelated speech", () => {
    expect(extractEdgeCandidates("今日はいい天気ですね")).toEqual([]);
  });

  it("handles multiple clauses in one utterance independently", () => {
    const candidates = extractEdgeCandidates("証拠がなければ告発できない。説得には証拠が必要。");
    expect(candidates.map((c) => c.relation)).toEqual(["blocks", "depends_on"]);
  });
});
