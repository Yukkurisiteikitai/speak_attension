import { describe, expect, it } from "vitest";
import type { AnalyzedSegment } from "../types/topic";
import { analyzeDecisionMaterials, updateDecisionMaterialStatus } from "./decisionSupport";

const segment = (id: string, text: string) => ({ id, text, createdAt: 1, source: "manual" as const, analysis: {} as never, matchedTopicIds: [] } as AnalyzedSegment);
const ready = () => analyzeDecisionMaterials([segment("s1", "金曜日に公開したい"), segment("s2", "不具合が怖い")]);

describe("decision support", () => {
  it("offers materials before a decision, while marking comparison options as inferred", () => { const materials = ready(); expect(materials).toHaveLength(3); expect(materials[1].inferred[0]).toContain("仮置き案"); });
  it("offers a small-trial comparison even before a concrete decision exists", () => { const materials = analyzeDecisionMaterials([segment("s1", "サービスが必要とされるか確かめたい")]); expect(materials[0]?.question).toContain("少人数で試して"); });
  it("does not turn silence or a generic topic into an unknown warning", () => { expect(analyzeDecisionMaterials([segment("s1", "予算について話します")])).toEqual([]); });
  it("keeps only decision-relevant materials and lets reversible scope be deferred", () => { const material = ready()[1]; expect(material.title).toContain("公開範囲"); expect(updateDecisionMaterialStatus([material], material.id, "deferred")[0].status).toBe("deferred"); });
  it("does not force owners or deadlines for brainstorming", () => { expect(analyzeDecisionMaterials([segment("s1", "アイデアを出しましょう"), segment("s2", "不具合が怖い")])).toEqual([]); });
  it("suppresses a processed material under the same premise", () => { const checked = updateDecisionMaterialStatus(ready(), "decision-material-release-readiness", "checked"); expect(analyzeDecisionMaterials([segment("s1", "金曜日に公開したい"), segment("s2", "不具合が怖い")], checked)[0].status).toBe("checked"); });
  it("reopens a processed material when supporting premises change", () => { const checked = updateDecisionMaterialStatus(ready(), "decision-material-release-readiness", "checked"); expect(analyzeDecisionMaterials([segment("s1", "月曜に全面公開したい"), segment("s2", "障害が怖い")], checked)[0].status).toBe("recheck"); });
  it("keeps unknowns distinct from confirmed evidence", () => { const material = ready()[0]; expect(material.confirmed).toContain("金曜日に公開したい"); expect(material.unknown).toContain("停止判断をする担当者"); });
  it("makes conditional futures explicit rather than factual", () => { expect(ready()[0].conditionalHypothesis.if).toContain("不具合"); });
  it("retains real source IDs only", () => { expect(ready().flatMap((item) => item.sourceEvidenceSegmentIds)).toEqual(expect.arrayContaining(["s1", "s2"])); });
  it("returns no false safe fallback when context is insufficient", () => { expect(analyzeDecisionMaterials([])).toEqual([]); });
});
