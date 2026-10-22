import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer } from "ws";

const port = Number(process.env.WS_PORT || 8787);
const logDirectory = process.env.LOG_DIRECTORY || join(process.cwd(), "logs");

type RuntimeLog = {
  at: string;
  source: "frontend" | "backend";
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  details?: Record<string, unknown>;
};

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function writeLog(entry: RuntimeLog) {
  await mkdir(logDirectory, { recursive: true });
  await appendFile(join(logDirectory, `runtime-${entry.at.slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
}

function backendLog(level: RuntimeLog["level"], event: string, message?: string, details?: Record<string, unknown>) {
  void writeLog({ at: new Date().toISOString(), source: "backend", level, event, message, details }).catch(() => undefined);
}

async function receiveFrontendLog(request: IncomingMessage, response: ServerResponse) {
  try {
    const raw = await readBody(request);
    if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("ログが大きすぎます。");
    const payload = JSON.parse(raw) as Partial<RuntimeLog>;
    await writeLog({
      at: new Date().toISOString(), source: "frontend",
      level: payload.level === "warn" || payload.level === "error" ? payload.level : "info",
      event: typeof payload.event === "string" ? payload.event.slice(0, 120) : "frontend.event",
      message: typeof payload.message === "string" ? payload.message.slice(0, 2_000) : undefined,
      details: payload.details && typeof payload.details === "object" ? payload.details : undefined,
    });
    sendJson(response, 202, { ok: true });
  } catch (error) {
    sendJson(response, 400, { error: { message: error instanceof Error ? error.message : "ログを保存できませんでした。" } });
  }
}

async function sendDiscordReport(request: IncomingMessage, response: ServerResponse) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    sendJson(response, 503, { error: { message: "DISCORD_WEBHOOK_URL が .env に設定されていません。" } });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(request)) as { content?: unknown };
    if (typeof payload.content !== "string" || !payload.content.trim()) throw new Error("レポート本文がありません。");
    const result = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: payload.content.slice(0, 2_000) }) });
    if (!result.ok) throw new Error(`Discord Webhook: HTTP ${result.status}`);
    backendLog("info", "discord.report.sent");
    sendJson(response, 200, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord送信に失敗しました。";
    backendLog("error", "discord.report.failed", message);
    sendJson(response, 502, { error: { message } });
  }
}

const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/logs") {
    void receiveFrontendLog(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/discord/report") {
    void sendDiscordReport(request, response);
    return;
  }
  sendJson(response, 404, { error: { message: "Not found" } });
});

const webSocketServer = new WebSocketServer({ noServer: true });
webSocketServer.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "server:ready", at: Date.now(), message: "Live Topic Graph WebSocket connected" }));
  socket.on("message", (payload) => {
    const message = payload.toString();
    for (const client of webSocketServer.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  });
});

server.on("upgrade", (request, socket, head) => {
  webSocketServer.handleUpgrade(request, socket, head, (client) => webSocketServer.emit("connection", client, request));
});

server.listen(port, "127.0.0.1", () => {
  backendLog("info", "server.started", undefined, { port });
  console.log(`Local server listening on http://127.0.0.1:${port}`);
});
