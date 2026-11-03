// Durable Object: hält die WebSocket-Verbindungen aller Browser (Hibernation API, kostet im Leerlauf nichts),
// verteilt Änderungsmeldungen und meldet, welche Mitglieder gerade verbunden sind. Genau eine Instanz ("hub").
import { DurableObject } from "cloudflare:workers";

interface Attachment { id: number | null; name: string }

export class Hub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      this.send(await request.text());
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const att: Attachment = { id: Number(request.headers.get("X-Member-Id")) || null, name: decodeURIComponent(request.headers.get("X-Member-Name") ?? "") };
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(att);
      pair[1].send(JSON.stringify({ type: "hello", clients: this.ctx.getWebSockets().length }));
      this.sendPresence();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/presence") return Response.json(this.presence());
    return new Response("Not found", { status: 404 });
  }

  private send(msg: string) {
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch { /* Verbindung ist weg */ } }
  }

  /** Verbundene Mitglieder, je Mitglied einmal (mehrere Geräte zählen als eins). */
  private presence(except?: WebSocket): { id: number; name: string }[] {
    const seen = new Map<number, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue; // gerade schließende Verbindung nicht mehr mitzählen
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.id) seen.set(a.id, a.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  }

  private sendPresence(except?: WebSocket) { this.send(JSON.stringify({ type: "presence", members: this.presence(except) })); }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send('{"type":"pong"}');
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try { ws.close(code, reason); } catch { /* bereits zu */ }
    this.sendPresence(ws);
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, "error"); } catch { /* bereits zu */ }
    this.sendPresence(ws);
  }
}
