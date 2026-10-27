import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer } from "./localServer";

const origin = "http://127.0.0.1:5173";
let app: Server;
let webhook: Server;
let appUrl: string;
let webhookUrl: string;
let logDirectory: string;
const posted: string[] = [];

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Port unavailable");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  logDirectory = await mkdtemp(join(tmpdir(), "speak-security-"));
  webhook = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      posted.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(204);
      response.end();
    });
  });
  webhookUrl = await listen(webhook);
  app = createLocalServer({ logDirectory, webhookUrl });
  appUrl = await listen(app);
});

afterAll(async () => {
  if (app?.listening) await close(app);
  if (webhook?.listening) await close(webhook);
  if (logDirectory) await rm(logDirectory, { recursive: true, force: true });
});

describe("local API boundary", () => {
  it("rejects foreign or absent Origin and simple content types before forwarding", async () => {
    const initialPosts = posted.length;
    expect((await post("/api/discord/report", { content: "attack" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/api/logs", { event: "attack" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await fetch(`${appUrl}/api/discord/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"content":"attack"}' })).status).toBe(403);
    expect((await post("/api/discord/report", { content: "attack" }, { "Content-Type": "text/plain" })).status).toBe(415);
    expect(posted).toHaveLength(initialPosts);
  });

  it("accepts local JSON while rejecting oversized bodies and silent truncation", async () => {
    expect((await post("/api/logs", { event: "test.event", details: { safe: true } })).status).toBe(202);
    const line = await readFile(join(logDirectory, `runtime-${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
    expect(line).toContain('"event":"test.event"');
    expect((await post("/api/logs", { message: "x".repeat(70 * 1024) })).status).toBe(413);
    expect((await post("/api/discord/report", { content: "x".repeat(2001) })).status).toBe(413);
    expect((await post("/api/discord/report", { content: "part 1/1" })).status).toBe(200);
    expect(JSON.parse(posted.at(-1) ?? "{}")).toEqual({ content: "part 1/1" });
  });

  it("bounds chunked uploads and repeated accepted requests", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${appUrl}/api/logs`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      request.on("error", reject);
      request.write('{"message":"');
      request.write("x".repeat(70 * 1024));
      request.end('"}');
    });
    expect(status).toBe(413);

    let limited = false;
    for (let attempt = 0; attempt < 121; attempt += 1) {
      const response = await post("/api/logs", { event: "rate.test" });
      if (response.status === 429) {
        expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
