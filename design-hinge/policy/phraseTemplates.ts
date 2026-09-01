import type { HingeGraph } from "../graph/types";
import type { InterventionCandidate } from "./types";

// Mandatory deterministic fallback per AGENTS.md's hard constraint ("every
// LLM-touching feature needs a deterministic rule-based fallback"). This is
// what ships when LM Studio is off, exactly as meetingSynthesis.ts's
// buildRuleBasedMeetingSummary does for the existing meeting engine.
export function buildTemplateQuestion(candidate: InterventionCandidate, graph: HingeGraph): string {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  switch (candidate.triggerType) {
    case "graph_gap": {
      if (candidate.reasonCode.startsWith("isolated_node:")) {
        const node = nodeById.get(candidate.relatedNodeIds[0]);
        const label = node?.label ?? "この要素";
        return `「${label}」はどの要素とも因果関係がありません。何が原因、または何を引き起こしますか?`;
      }
      const sourceLabel = nodeById.get(candidate.relatedNodeIds[0])?.label ?? "";
      const targetLabel = nodeById.get(candidate.relatedNodeIds[1])?.label ?? "";
      return `「${sourceLabel}」から「${targetLabel}」への因果関係は本当に成り立ちますか?`;
    }
    case "contradiction": {
      const sourceLabel = nodeById.get(candidate.relatedNodeIds[0])?.label ?? "";
      const targetLabel = nodeById.get(candidate.relatedNodeIds[1])?.label ?? "";
      return `「${sourceLabel}」と「${targetLabel}」の関係について、矛盾する見方があります。どちらが正しいですか?`;
    }
    case "silence":
      return "少し間が空きました。今考えていることを聞かせてください。";
    case "stagnation":
      return "似た話が続いています。違う角度から見るとどうなりますか?";
    case "counterfactual": {
      const node = nodeById.get(candidate.relatedNodeIds[0]);
      const label = node?.label ?? "この要素";
      return `「${label}」がなかったとしたら、結果はどう変わりますか?`;
    }
    case "manual":
      return "今の話について、深掘りしたい点はありますか?";
    default:
      return "続きを聞かせてください。";
  }
}
