// Deliberately duplicated (not imported) from src/utils/topicExtraction.ts's
// normalizeForMatch/tokenize shape. That file's stop-word list and particle
// stripping are tuned for meeting-topic vocabulary; Design Hinge's causal-graph
// text is a different domain and needs its own tuning over time without
// silently breaking meeting mode (or vice versa).

const PARTICLE_PATTERN = /(について|の件|って|では|です|ます|する|したい|した|で|が|は|を|に|と|も|から|まで)/g;

export function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase("ja-JP")
    .replace(/[「」『』（）()【】［］.,、。!?！？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeForMatch(text).replace(PARTICLE_PATTERN, " ");
  const matches = normalized.match(/[a-z0-9]+|[一-龠ぁ-んァ-ヶー]{2,}/g) ?? [];
  return matches.filter((token) => token.length >= 2);
}

// Substitute for deep_research.md's pgvector cosine-similarity stagnation
// check (no local embedding model is in scope). Deterministic and network-free;
// the doc's 0.85 similarity threshold doesn't carry over numerically, since
// token overlap and embedding cosine distance aren't the same scale.
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionSize += 1;
  }
  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  if (unionSize === 0) return 0;
  return intersectionSize / unionSize;
}
