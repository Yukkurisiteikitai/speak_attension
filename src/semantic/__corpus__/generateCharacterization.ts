import fs from "fs";
import path from "path";
import { loadCorpus } from "./loadCorpus";
import { classifyUtterance } from "../../utils/utteranceClassification";
import { classifyConversationRole } from "../../utils/conversationTree";
import { detectUtteranceIntent } from "../../utils/intentRules";
import { appendMeetingDecisionSegment, type MeetingDecisionGraph } from "../../utils/meetingDecisionGraph";
import { buildMeetingStateDashboard } from "../../utils/meetingStateDashboard";
import type { AnalyzedSegment } from "../../types/topic";

export type UtteranceCharacterization = {
  text: string;
  timeline: ReturnType<typeof classifyUtterance>;
  tree: ReturnType<typeof classifyConversationRole>;
  intent: ReturnType<typeof detectUtteranceIntent>;
  decisionNodeTypes: string[];
};

export type CaseCharacterization = {
  caseId: string;
  utterances: UtteranceCharacterization[];
  confirmedDecisions: string[];
  nextActions: Array<{ what: string; owner: string | null; deadline: string | null }>;
  structuralGapsCount: number;
  unresolvedItemsCount: number;
};

export function generateCharacterization(): CaseCharacterization[] {
  const corpus = loadCorpus();
  const characterizations: CaseCharacterization[] = [];

  for (const testCase of corpus) {
    let graph: MeetingDecisionGraph = { nodes: [], edges: [] };
    const utteranceCharacterizations: UtteranceCharacterization[] = [];

    for (const utterance of testCase.utterances) {
      const text = utterance.text;

      // Record individual utterance analysis
      const timeline = classifyUtterance(text);
      const tree = classifyConversationRole(text, true);
      const intent = detectUtteranceIntent(text);

      // Apply to decision graph and record node types
      const segment: AnalyzedSegment = {
        id: `${testCase.id}-${utteranceCharacterizations.length}`,
        text,
        createdAt: 0,
        source: "manual",
        matchedTopicIds: [],
        metadata: { speaker: utterance.speaker },
        analysis: {} as AnalyzedSegment["analysis"],
      };

      const before = graph;
      graph = appendMeetingDecisionSegment(graph, segment);
      const newNodes = graph.nodes.filter(
        (node) => !before.nodes.some((n) => n.id === node.id) && node.type !== "utterance",
      );
      const decisionNodeTypes = newNodes.map((n) => n.type);

      utteranceCharacterizations.push({
        text,
        timeline,
        tree,
        intent,
        decisionNodeTypes,
      });
    }

    // Build final dashboard state
    const dashboard = buildMeetingStateDashboard(graph, [], null);

    const caseCharacterization: CaseCharacterization = {
      caseId: testCase.id,
      utterances: utteranceCharacterizations,
      confirmedDecisions: dashboard.confirmedDecisions.map((d) => d.label),
      nextActions: dashboard.nextActions.map((a) => ({
        what: a.label,
        owner: a.action?.owner ?? null,
        deadline: a.action?.deadline ?? null,
      })),
      structuralGapsCount: dashboard.structuralGaps.length,
      unresolvedItemsCount: dashboard.unresolvedItems.length,
    };

    characterizations.push(caseCharacterization);
  }

  return characterizations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const characterizations = generateCharacterization();
  const outputPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "characterization",
    "legacy.snap.json",
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(characterizations, null, 2));
  console.log(`Characterization snapshot generated: ${outputPath}`);
}
