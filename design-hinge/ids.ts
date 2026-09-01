// Deliberately duplicated (not imported) from src/utils/topicProjection.ts's
// createId — that file is meeting-mode-specific, and design-hinge/ stays
// decoupled from mode-specific util files even for trivial helpers.
export function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
