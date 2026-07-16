import { useState } from "react";
import { DEFAULT_LLM_SETTINGS, type LlmSettings } from "../utils/llmClient";

export function useLlmSettings(storageKey = "speak_attension.llmSettings") {
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return DEFAULT_LLM_SETTINGS;
      const parsed = JSON.parse(raw) as Partial<LlmSettings>;
      return {
        baseUrl: parsed.baseUrl || DEFAULT_LLM_SETTINGS.baseUrl,
        model: parsed.model || DEFAULT_LLM_SETTINGS.model,
      };
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
