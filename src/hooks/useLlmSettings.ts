import { useState } from "react";
import { DEFAULT_LLM_SETTINGS, restoreLocalLlmSettings, type LlmSettings } from "../utils/llmClient";

export function useLlmSettings(storageKey = "speak_attension.llmSettings") {
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return DEFAULT_LLM_SETTINGS;
      const parsed = JSON.parse(raw) as Partial<LlmSettings>;
      const restored = restoreLocalLlmSettings(parsed);
      if (restored.baseUrl !== parsed.baseUrl || restored.model !== parsed.model) {
        window.localStorage.setItem(storageKey, JSON.stringify(restored));
      }
      return restored;
    } catch {
      return DEFAULT_LLM_SETTINGS;
    }
  });

  const updateLlmSettings = (patch: Partial<LlmSettings>) => {
    setLlmSettingsState((current) => {
      const next = { ...current, ...patch };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  return { llmSettings, updateLlmSettings };
}
