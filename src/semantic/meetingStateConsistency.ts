export type MeetingStateConsistency = {
  canonicalOnlyDecisions: string[];
  dashboardOnlyDecisions: string[];
};

export function compareDecisionProjections(canonicalTitles: Iterable<string>, dashboardTitles: Iterable<string>): MeetingStateConsistency {
  const canonical = new Set(canonicalTitles);
  const dashboard = new Set(dashboardTitles);
  return {
    canonicalOnlyDecisions: [...canonical].filter((title) => !dashboard.has(title)).sort(),
    dashboardOnlyDecisions: [...dashboard].filter((title) => !canonical.has(title)).sort(),
  };
}
