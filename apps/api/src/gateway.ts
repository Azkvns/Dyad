import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Buffer } from "node:buffer";
import { clientFrameSchema } from "contracts";
import type { FastifyInstance } from "fastify";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import { cookieToken } from "./current-user";
import { HttpError } from "./http-error";
import { AuthService } from "./services/auth-service";
import { CursorService } from "./services/cursor-service";
import { clearHub, flushHub, hub } from "./services/hub";
import { MessageService } from "./services/message-service";

export const IDLE_MS = 90_000;

const timers = new Map<WebSocket, NodeJS.Timeout>();

function frameText(data: RawData): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return null;
}

function clientMsgIdOf(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const row = json as { type?: unknown; clientMsgId?: unknown };
  if (row.type !== "message.send" || typeof row.clientMsgId !== "string") return undefined;
  return z.uuid().safeParse(row.clientMsgId).success ? row.clientMsgId : undefined;
}

function sendJson(ws: WebSocket, frame: Record<string, unknown>): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(frame));
}

function sendError(ws: WebSocket, code: string, clientMsgId?: string): void {
  const frame = clientMsgId ? { type: "error", code, clientMsgId } : { type: "error", code };
  try {
    sendJson(ws, frame);
  } catch {
    ws.terminate();
  }
}

export function attachGateway(app: FastifyInstance, idleMs = IDLE_MS): void {
  const wss = new WebSocketServer({ noServer: true });

  function arm(ws: WebSocket): void {
    const previous = timers.get(ws);
    if (previous) clearTimeout(previous);
    timers.set(
      ws,
      setTimeout(() => {
        ws.close(1000);
      }, idleMs),
    );
  }

  function disarm(ws: WebSocket): void {
    const previous = timers.get(ws);
    if (previous) clearTimeout(previous);
    timers.delete(ws);
  }

  async function handleText(userId: string, ws: WebSocket, text: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      sendError(ws, "validation_error");
      return;
    }
    const parsed = clientFrameSchema.safeParse(json);
    if (!parsed.success) {
      sendError(ws, "validation_error", clientMsgIdOf(json));
      return;
    }
    const frame = parsed.data;
    try {
      if (frame.type === "ping") {
        sendJson(ws, { type: "pong" });
        return;
      }
      if (frame.type === "message.send") {
        await new MessageService(app.db).send(userId, frame.dialogId, frame.body, frame.clientMsgId);
        return;
      }
      if (frame.type === "cursor.delivered") {
        await new CursorService(app.db).delivered(userId, frame.dialogId, frame.seq);
        return;
      }
      await new CursorService(app.db).read(userId, frame.dialogId, frame.seq);
    } catch (error) {
      const clientMsgId = frame.type === "message.send" ? frame.clientMsgId : undefined;
      if (error instanceof HttpError) {
        sendError(ws, error.body.error, clientMsgId);
        return;
      }
      app.log.error({ err: error }, "websocket frame failed");
      sendError(ws, "internal", clientMsgId);
    }
  }

  function accept(ws: WebSocket, userId: string | null): void {
    ws.on("error", () => {});
    if (!userId) {
      ws.close(4401);
      return;
    }
    hub.attach(userId, ws);
    arm(ws);
    let chain = Promise.resolve();
    ws.on("message", (data) => {
      arm(ws);
      const text = frameText(data);
      chain = chain
        .then(async () => {
          if (text === null) {
            sendError(ws, "validation_error");
            return;
          }
          await handleText(userId, ws, text);
        })
        .catch((error: unknown) => {
          app.log.error({ err: error }, "websocket frame failed");
        });
    });
    ws.on("close", () => {
      disarm(ws);
      hub.detach(userId, ws);
    });
    sendJson(ws, { type: "ready" });
  }

  app.server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const fail = () => {
      socket.destroy();
    };
    socket.on("error", fail);
    void (async () => {
      let pathname = "";
      try {
        pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      } catch {
        fail();
        return;
      }
      if (pathname !== "/ws") {
        fail();
        return;
      }
      const token = cookieToken(request.headers.cookie);
      const session = token ? await new AuthService(app.db).readSession(token) : null;
      socket.removeListener("error", fail);
      wss.handleUpgrade(request, socket, head, (ws) => {
        accept(ws, session?.userId ?? null);
      });
    })().catch((error: unknown) => {
      app.log.error({ err: error }, "websocket upgrade failed");
      fail();
    });
  });

  app.addHook("onClose", async () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    await flushHub();
    clearHub();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
  });
}
