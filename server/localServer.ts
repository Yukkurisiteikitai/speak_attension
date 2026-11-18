import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

const allowedOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const logBodyLimit = 64 * 1024;
const reportBodyLimit = 16 * 1024;
const dailyLogLimit = 2 * 1024 * 1024;
const requestsPerMinute = 120;

type RuntimeLog = {
  at: string;
  source: "frontend" | "backend";
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  details?: Record<string, unknown>;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  if (response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

function discardBody(request: IncomingMessage) {
  const ignoreError = () => undefined;
  request.on("error", ignoreError);
  request.once("close", () => request.off("error", ignoreError));
  request.resume();
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    discardBody(request);
    return Promise.reject(new HttpError(413, "本文が大きすぎます。"));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new HttpError(400, "接続が切れました。")); };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, bytes).toString("utf8")); };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        cleanup();
        discardBody(request);
        reject(new HttpError(413, "本文が大きすぎます。"));
        return;
      }
      chunks.push(chunk);
    };
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("close", onClose);
    };
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("close", onClose);
  });
}

function parseObject(raw: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new HttpError(400, "JSONを解析できません。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSONオブジェクトを指定してください。");
  return value as Record<string, unknown>;
}

function errorResponse(response: ServerResponse, error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : "処理に失敗しました。";
  sendJson(response, status, { error: { message } });
}

export function createLocalServer(options: { logDirectory: string; webhookUrl?: string }) {
  const rateCounters = new Map<string, { startedAt: number; count: number }>();
  let logQueue = Promise.resolve();

  function writeLog(entry: RuntimeLog): Promise<void> {
    const queued = logQueue.then(async () => {
      const line = `${JSON.stringify(entry)}\n`;
      const size = Buffer.byteLength(line);
      if (size > 4096) throw new HttpError(413, "ログ項目が大きすぎます。");
      const path = join(options.logDirectory, `runtime-${entry.at.slice(0, 10)}.jsonl`);
      await mkdir(options.logDirectory, { recursive: true });
      const currentSize = await stat(path).then((file) => file.size, () => 0);
      if (currentSize + size > dailyLogLimit) throw new HttpError(507, "本日のログ保存上限に達しました。");
      await appendFile(path, line, "utf8");
    });
    logQueue = queued.catch(() => undefined);
    return queued;
  }

  function backendLog(level: RuntimeLog["level"], event: string) {
    void writeLog({ at: new Date().toISOString(), source: "backend", level, event }).catch(() => undefined);
  }

  async function receiveFrontendLog(request: IncomingMessage, response: ServerResponse) {
    try {
      const payload = parseObject(await readBody(request, logBodyLimit));
      const details = payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
        && Buffer.byteLength(JSON.stringify(payload.details)) <= 2048
        ? payload.details as Record<string, unknown> : undefined;
      await writeLog({
        at: new Date().toISOString(), source: "frontend",
        level: payload.level === "warn" || payload.level === "error" ? payload.level : "info",
        event: typeof payload.event === "string" ? payload.event.slice(0, 120) : "frontend.event",
        message: typeof payload.message === "string" ? payload.message.slice(0, 2000) : undefined,
        details,
      });
      sendJson(response, 202, { ok: true });
    } catch (error) { errorResponse(response, error); }
  }

  async function sendDiscordReport(request: IncomingMessage, response: ServerResponse) {
    if (!options.webhookUrl) {
      sendJson(response, 503, { error: { message: "DISCORD_WEBHOOK_URL が .env に設定されていません。" } });
      discardBody(request);
      return;
    }
    try {
      const payload = parseObject(await readBody(request, reportBodyLimit));
      if (typeof payload.content !== "string" || !payload.content.trim()) throw new HttpError(400, "レポート本文がありません。");
      if (payload.content.length > 2000) throw new HttpError(413, "Discordの1投稿の上限は2000文字です。");
      const result = await fetch(options.webhookUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload.content }), signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new HttpError(502, `Discord Webhook: HTTP ${result.status}`);
      backendLog("info", "discord.report.sent");
      sendJson(response, 200, { ok: true });
    } catch (error) {
      backendLog("error", "discord.report.failed");
      errorResponse(response, error instanceof HttpError ? error : new HttpError(502, "Discord送信に失敗しました。"));
    }
  }

  const server = createServer((request, response) => {
    if (request.method !== "POST" || (request.url !== "/api/logs" && request.url !== "/api/discord/report")) {
      sendJson(response, 404, { error: { message: "Not found" } });
      discardBody(request);
      return;
    }
    if (!allowedOrigins.has(request.headers.origin ?? "")) {
      sendJson(response, 403, { error: { message: "Originが許可されていません。" } });
      discardBody(request);
      return;
    }
    if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      sendJson(response, 415, { error: { message: "application/jsonを指定してください。" } });
      discardBody(request);
      return;
    }
    const key = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const counter = rateCounters.get(key);
    if (!counter || now - counter.startedAt >= 60_000) rateCounters.set(key, { startedAt: now, count: 1 });
    else if (++counter.count > requestsPerMinute) {
      sendJson(response, 429, { error: { message: "送信回数が多すぎます。" } }, { "Retry-After": String(Math.ceil((60_000 - (now - counter.startedAt)) / 1000)) });
      discardBody(request);
      return;
    }
    if (request.url === "/api/logs") void receiveFrontendLog(request, response);
    else void sendDiscordReport(request, response);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
