import type { AnalyzedSegment, DecisionMaterial, DecisionMaterialStatus } from "../types/topic";

const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const launchPattern = /公開|リリース|配信|導入|デプロイ|本番/;
const riskPattern = /不具合|障害|エラー|怖|品質|壊|失敗/;
const trialPattern = /試す|限定|少人数|段階|パイロット/;
const discoveryPattern = /サービス|利用者|ユーザー|需要|必要.*確かめ|ニーズ/;

function matching(segments: AnalyzedSegment[], pattern: RegExp) {
  return segments.filter((segment) => pattern.test(segment.text));
}

function fingerprint(segments: AnalyzedSegment[]): string {
  return segments.map((segment) => segment.text.replace(/\s+/g, "").slice(0, 80)).join("|");
}

// This is intentionally narrow. It does not infer generic risks merely from
// silence; a release/delivery context and a stated concern are both required.
export function analyzeDecisionMaterials(segments: AnalyzedSegment[], previous: DecisionMaterial[] = []): DecisionMaterial[] {
  const launch = matching(segments, launchPattern);
  const risk = matching(segments, riskPattern);
  const discovery = matching(segments, discoveryPattern);
  const prior = new Map(previous.map((material) => [material.id, material]));
  const preserve = (material: DecisionMaterial): DecisionMaterial => {
    const old = prior.get(material.id);
    if (!old) return material;
    return { ...material, status: old.premiseFingerprint === material.premiseFingerprint ? old.status : old.status === "open" ? "open" : "recheck" };
  };
  if (!launch.length || !risk.length) {
    if (!discovery.length) return [];
    const premiseFingerprint = fingerprint(discovery);
    return [preserve({
      id: "decision-material-need-validation", kind: "comparison", status: "open", title: "必要性を確かめる方法",
      question: "全面投入の前に、少人数で試して利用者の反応を確かめる方法と、何が分かれば次へ進むかを比べますか？",
      confirmed: discovery.map((segment) => segment.text), inferred: ["少人数で試すことは、参加者の提案ではなく比較用の仮置き案です。"],
      unknown: ["誰に試すか", "必要と判断する基準", "試行結果で変える判断"], sourceEvidenceSegmentIds: discovery.map((segment) => segment.id),
      conditionalHypothesis: { if: "必要性がまだ確認できていない", and: "後から変更しにくい投入を先に行う", then: "投入方法を変える可能性がある", therefore: "小さく試して得る情報を先に定める価値がある" },
      rationale: "サービスの必要性を確かめたいという実際の発言があります。", notNeededReason: "対象者・判断基準・試行方法が既に合意済みなら不要です。", premiseFingerprint,
    })];
  }
  const evidence = unique([...launch, ...risk].map((segment) => segment.id));
  const premiseFingerprint = fingerprint([...launch, ...risk]);
  const context = launch[launch.length - 1].text;
  const concern = risk[risk.length - 1].text;
  return [preserve({
    id: "decision-material-release-readiness", kind: "meeting_fact", status: "open",
    title: "公開時の停止判断と対応体制", question: "公開後に問題が起きた場合、停止判断をする人と連絡・復旧の手順は確認できていますか？",
    confirmed: [context, concern], inferred: ["対応体制の有無で、公開日または公開範囲の判断が変わる可能性があります。"],
    unknown: ["停止判断をする担当者", "ロールバックまたは復旧の可否"], sourceEvidenceSegmentIds: evidence,
    conditionalHypothesis: { if: "公開後に不具合が発生する", and: "停止判断をできる人や手順が確認できていない", then: "公開継続・停止の判断が遅れる可能性がある", therefore: "対応体制によって公開条件を変える価値がある" },
    rationale: "公開の話と不具合への懸念が、どちらも実際の発言にあります。", notNeededReason: "対応者と復旧手順が既に確認済みで、公開条件に影響しない場合は不要です。", premiseFingerprint,
  }), preserve({
    id: "decision-material-release-scope", kind: "comparison", status: "open",
    title: "公開範囲を比較する", question: "全面公開、限定公開、小さく試してから公開のどれが、確認できた事実に合いますか？",
    confirmed: [context, concern], inferred: ["限定公開や小規模試行は、参加者がまだ提案していない比較用の仮置き案です。"],
    unknown: ["不具合の影響範囲", "限定公開で検証できる利用者・条件"], sourceEvidenceSegmentIds: evidence,
    conditionalHypothesis: { if: "不具合の影響が大きい", and: "公開範囲を後から狭めにくい", then: "全面公開を選ばない可能性がある", therefore: "公開範囲を決める前に影響範囲を確認する価値がある" },
    rationale: "可逆性の異なる選択肢を比較するための材料です。AIやルールが参加者の提案として扱うものではありません。", notNeededReason: "影響範囲と公開後の変更方法が確認済みなら、比較を省けます。", premiseFingerprint,
  }), preserve({
    id: "decision-material-release-value", kind: "value_choice", status: "open",
    title: "速度と安全性の優先度", question: "今回の公開では、予定どおり進めることと安全性を高めることの、どちらを優先しますか？",
    confirmed: [context, concern], inferred: [], unknown: ["参加者が合意する優先順位"], sourceEvidenceSegmentIds: evidence,
    conditionalHypothesis: { if: "公開を急ぐ理由がある", and: "不具合の影響が許容できない", then: "どちらを優先するかで選択が変わる", therefore: "優先順位は人が明示して決める必要がある" },
    rationale: "事実不足ではなく、参加者が選ぶ価値判断です。", notNeededReason: "優先順位が既に明示され、関係者間で共有済みなら不要です。", premiseFingerprint,
  })];
}

export function updateDecisionMaterialStatus(materials: DecisionMaterial[], id: string, status: DecisionMaterialStatus): DecisionMaterial[] {
  return materials.map((material) => material.id === id ? { ...material, status } : material);
}
