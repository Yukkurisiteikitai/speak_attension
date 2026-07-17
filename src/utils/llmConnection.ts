import { fetchModelIds, type LlmSettings } from "./llmClient";

export type LlmConnectionCheckResult = {
  statusMessage: string;
  autofillModel: string | null;
};

// Shared connection probe for the LM Studio settings UI in both modes.
// Returns a user-facing status message instead of throwing so callers can
// render it directly; autofillModel is set when the settings have no model yet.
export async function checkLlmConnection(
  settings: LlmSettings,
  fetchModels: (settings: LlmSettings) => Promise<string[]> = fetchModelIds,
): Promise<LlmConnectionCheckResult> {
  try {
    const modelIds = await fetchModels(settings);
    if (modelIds.length === 0) {
      return { statusMessage: "接続はできましたが、ロード済みモデルがありません。", autofillModel: null };
    }
    return {
      statusMessage: `接続成功: ${modelIds.join(", ")}`,
      autofillModel: settings.model ? null : modelIds[0],
    };
  } catch (error) {
    return {
      statusMessage: `接続失敗: ${error instanceof Error ? error.message : String(error)}`,
      autofillModel: null,
    };
  }
}
