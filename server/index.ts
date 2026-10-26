import { join } from "node:path";
import { createLocalServer } from "./localServer";

const port = Number(process.env.API_PORT ?? process.env.WS_PORT ?? 8787);
const logDirectory = process.env.LOG_DIRECTORY || join(process.cwd(), "logs");
const server = createLocalServer({ logDirectory, webhookUrl: process.env.DISCORD_WEBHOOK_URL });

server.listen(port, "127.0.0.1", () => {
  console.log(`Local API listening on http://127.0.0.1:${port}`);
});
