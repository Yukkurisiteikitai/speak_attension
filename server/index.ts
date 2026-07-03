import { WebSocketServer } from "ws";

const port = Number(process.env.WS_PORT || 8787);
const server = new WebSocketServer({ port });

server.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "server:ready",
      at: Date.now(),
      message: "Live Topic Graph WebSocket connected",
    }),
  );

  socket.on("message", (payload) => {
    const message = payload.toString();
    for (const client of server.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  });
});

server.on("listening", () => {
  console.log(`Live Topic Graph WebSocket server listening on ws://127.0.0.1:${port}`);
});
