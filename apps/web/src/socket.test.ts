import { describe, expect, it, vi } from "vitest";
import { connectSocket, socketUrl } from "./socket";

type Listener = (event: { data?: string; code?: number }) => void;

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }

  message(data: string): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener({ code });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.serverClose(1000);
  }
}

describe("socket", () => {
  it("builds a same-origin ws url", () => {
    expect(socketUrl({ protocol: "http:", host: "127.0.0.1:5173" })).toBe("ws://127.0.0.1:5173/ws");
    expect(socketUrl({ protocol: "https:", host: "dyad.example" })).toBe("wss://dyad.example/ws");
  });

  it("flushes queued frames, pings every 25s, and resets the pause", () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const frames: unknown[] = [];
    const ready = vi.fn();
    const session = connectSocket({
      url: "ws://test/ws",
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onFrame: (frame) => frames.push(frame),
      onReady: ready,
      onUnauthorized: vi.fn(),
      schedule: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clear: () => undefined,
    });
    session.send({ type: "message.send", dialogId: "22222222-2222-4222-8222-222222222222", body: "привет", clientMsgId: "33333333-3333-4333-8333-333333333333" });
    expect(FakeSocket.last?.sent).toEqual([]);
    FakeSocket.last?.open();
    expect(JSON.parse(FakeSocket.last?.sent[0] ?? "")).toMatchObject({ type: "message.send", body: "привет" });
    FakeSocket.last?.message(JSON.stringify({ type: "ready" }));
    expect(ready).toHaveBeenCalledOnce();
    expect(frames).toEqual([{ type: "ready" }]);
    expect(timers[0]?.ms).toBe(25_000);
    timers[0]?.fn();
    expect(JSON.parse(FakeSocket.last?.sent.at(-1) ?? "")).toEqual({ type: "ping" });
    FakeSocket.last?.message("nope");
    expect(frames).toHaveLength(1);
    FakeSocket.last?.serverClose(1006);
    expect(timers.at(-1)?.ms).toBe(1000);
    timers.at(-1)?.fn();
    FakeSocket.last?.open();
    FakeSocket.last?.serverClose(1006);
    expect(timers.at(-1)?.ms).toBe(1000);
  });

  it("does not reconnect after 4401 or a local close", () => {
    const timers: number[] = [];
    const onUnauthorized = vi.fn();
    const session = connectSocket({
      url: "ws://test/ws",
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onFrame: () => undefined,
      onReady: () => undefined,
      onUnauthorized,
      schedule: (_fn, ms) => {
        timers.push(ms);
        return timers.length;
      },
      clear: () => undefined,
    });
    FakeSocket.last?.serverClose(4401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(timers).toEqual([]);
    session.close();
    expect(timers).toEqual([]);
  });
});
