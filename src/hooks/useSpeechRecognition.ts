import { useCallback, useMemo, useRef, useState } from "react";
import type { SpeechStatus } from "../types/topic";

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionErrorLike = {
  error: string;
  message?: string;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type UseSpeechRecognitionOptions = {
  onFinalText: (text: string) => void;
};

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function toJapaneseError(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "マイク権限が拒否されました。ブラウザのサイト設定でマイクを許可してください。";
    case "no-speech":
      return "音声が検出されませんでした。マイク入力を確認してください。";
    case "audio-capture":
      return "マイクを取得できませんでした。接続やOSの入力設定を確認してください。";
    case "network":
      return "音声認識サービスに接続できませんでした。ブラウザまたはネットワーク状態を確認してください。";
    default:
      return `音声認識でエラーが発生しました: ${error}`;
  }
}

export function useSpeechRecognition({ onFinalText }: UseSpeechRecognitionOptions) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const [status, setStatus] = useState<SpeechStatus>(() => (getSpeechRecognitionConstructor() ? "idle" : "unsupported"));
  const [interimText, setInterimText] = useState("");
  const [lastFinalText, setLastFinalText] = useState("");
  const [error, setError] = useState<string | null>(() =>
    getSpeechRecognitionConstructor() ? null : "このブラウザでは Web Speech API が利用できません。Chrome系ブラウザで試してください。",
  );

  const isSupported = useMemo(() => Boolean(getSpeechRecognitionConstructor()), []);
  const isListening = status === "listening";

  const stop = useCallback(() => {
    shouldKeepListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setStatus(isSupported ? "idle" : "unsupported");
    setInterimText("");
  }, [isSupported]);

  const start = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setStatus("unsupported");
      setError("このブラウザでは Web Speech API が利用できません。Chrome系ブラウザで試してください。");
      return;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = "ja-JP";
      recognition.continuous = true;
      recognition.interimResults = true;
      shouldKeepListeningRef.current = true;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        let interim = "";
        let finalText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript?.trim() ?? "";
          if (!transcript) continue;
          if (result.isFinal) {
            finalText += `${transcript} `;
          } else {
            interim += `${transcript} `;
          }
        }

        const cleanFinal = finalText.trim();
        if (cleanFinal) {
          setLastFinalText(cleanFinal);
          onFinalText(cleanFinal);
        }
        setInterimText(interim.trim());
      };

      recognition.onerror = (event) => {
        setError(toJapaneseError(event.error));
        setStatus("error");
        shouldKeepListeningRef.current = false;
      };

      recognition.onend = () => {
        if (!shouldKeepListeningRef.current) {
          setStatus(isSupported ? "idle" : "unsupported");
          return;
        }

        try {
          recognition.start();
        } catch {
          setStatus("error");
          setError("音声認識の再開に失敗しました。もう一度開始してください。");
        }
      };

      recognition.start();
      setStatus("listening");
      setError(null);
    } catch {
      setStatus("error");
      setError("音声認識を開始できませんでした。マイク権限とブラウザ対応状況を確認してください。");
    }
  }, [isSupported, onFinalText]);

  return {
    error,
    interimText,
    isListening,
    isSupported,
    lastFinalText,
    start,
    status,
    stop,
  };
}
