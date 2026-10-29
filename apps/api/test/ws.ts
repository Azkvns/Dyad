import type { FastifyInstance } from "fastify";
import { WebSocket, type RawData } from "ws";

export async function listenEphemeral(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return address.port;
}

export function connect(port: number, cookie?: string, path = "/ws"): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function liveSlice(source: unknown[], start?: number, end?: number): unknown[] {
  return new Proxy([] as unknown[], {
    get(_target, prop) {
      const current = source.slice(start, end);
      const value: unknown = Reflect.get(current, prop);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}

export function collectFrames(ws: WebSocket): unknown[] {
  const frames: unknown[] = [];
  ws.on("message", (data: RawData) => {
    frames.push(JSON.parse(String(data)));
  });
  return new Proxy(frames, {
    get(target, prop, receiver) {
      if (prop === "slice") return (start?: number, end?: number) => liveSlice(target, start, end);
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function openClient(port: number, cookie: string): Promise<{ ws: WebSocket; frames: unknown[] }> {
  const ws = connect(port, cookie);
  const frames = collectFrames(ws);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, frames }));
    ws.once("error", reject);
  });
}

export function waitClose(ws: WebSocket, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("close timeout")), timeoutMs);
    ws.on("error", () => {});
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function waitFor(
  frames: unknown[],
  predicate: (frame: Record<string, unknown>) => boolean,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = frames.find((frame) => isRecord(frame) && predicate(frame));
    if (found && isRecord(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`missing frame: ${JSON.stringify(frames)}`);
}

export function closeQuiet(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once("close", () => resolve());
    ws.once("error", () => resolve());
    ws.terminate();
  });
}
