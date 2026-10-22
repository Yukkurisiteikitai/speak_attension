import type { HingeGraph } from "../graph/types";
import type { PolicyParameters } from "../policy/defaultParameters";
import type { DesignHingeEvent } from "./eventTypes";

// Mirrors src/utils/ideaSession.ts's buildIdeaSessionExport convention
// ({version, kind, generatedAt, ...}) so any future importer/re-ingestion code
// follows the same shape the rest of the app already expects.
export type DesignHingeSessionExport = {
  version: 1;
  kind: "design_hinge_session";
  generatedAt: number;
  sessionId: string;
  policyVersion: string;
  policyParameters: PolicyParameters;
  graph: HingeGraph;
  events: DesignHingeEvent[];
};

export type DesignHingeExportSourceState = {
  sessionId: string;
  policyVersion: string;
  policyParameters: PolicyParameters;
  graph: HingeGraph;
  events: DesignHingeEvent[];
};

export function buildDesignHingeExport(
  state: DesignHingeExportSourceState,
  generatedAt: number = Date.now(),
): DesignHingeSessionExport {
  return {
    version: 1,
    kind: "design_hinge_session",
    generatedAt,
    sessionId: state.sessionId,
    policyVersion: state.policyVersion,
    policyParameters: state.policyParameters,
    graph: state.graph,
    events: state.events,
  };
}
