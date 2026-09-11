export type RuntimeLogLevel = "info" | "warn" | "error";

// The browser sends compact operational metadata; the local server writes it
// to logs/*.jsonl because browser JavaScript cannot write files directly.
export function logRuntimeEvent(event: string, level: RuntimeLogLevel = "info", message?: string, details?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  void fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, level, message, details }),
    keepalive: true,
  }).catch(() => undefined);
}
