import { useCallback, useState } from "react";
import { checkLlmConnection } from "../utils/llmConnection";
import type { LlmSettings } from "../utils/llmClient";

type UseLlmConnectionCheckOptions = {
  settings: LlmSettings;
  onUpdateSettings: (patch: Partial<LlmSettings>) => void;
  pendingMessage?: string;
};

export function useLlmConnectionCheck({
  settings,
  onUpdateSettings,
  pendingMessage = "接続確認中…",
}: UseLlmConnectionCheckOptions) {
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    setConnectionStatus(pendingMessage);
    const result = await checkLlmConnection(settings);
    if (result.autofillModel) onUpdateSettings({ model: result.autofillModel });
    setConnectionStatus(result.statusMessage);
  }, [onUpdateSettings, pendingMessage, settings]);

  return {
    connectionStatus,
    setConnectionStatus,
    checkConnection,
  };
}
