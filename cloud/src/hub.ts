// Durable Object: hält die WebSocket-Verbindungen aller Browser (Hibernation API, kostet im Leerlauf nichts)
// und verteilt Änderungsmeldungen. Es gibt genau eine Instanz ("hub").
import { DurableObject } from "cloudflare:workers";

export class Hub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const msg = await request.text();
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch { /* Verbindung ist weg */ } }
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "hello", clients: this.ctx.getWebSockets().length }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/count") return new Response(String(this.ctx.getWebSockets().length));
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send('{"type":"pong"}');
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try { ws.close(code, reason); } catch { /* bereits zu */ }
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, "error"); } catch { /* bereits zu */ }
  }
}
