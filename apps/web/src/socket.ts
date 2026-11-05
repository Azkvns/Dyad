import { clientFrameSchema, serverFrameSchema, type ClientFrame, type ServerFrame } from "contracts";
import { reconnectDelayMs } from "./format";

export function socketUrl(location: { protocol: string; host: string }): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

export type SocketHandle = {
  send(frame: ClientFrame): void;
  close(): void;
};

export function connectSocket(options: {
  url: string;
  onFrame: (frame: ServerFrame) => void;
  onReady: () => void;
  onUnauthorized: () => void;
  WebSocketImpl?: typeof WebSocket;
  schedule?: (fn: () => void, ms: number) => number;
  clear?: (id: number) => void;
}): SocketHandle {
  const WS = options.WebSocketImpl ?? WebSocket;
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number);
  const clear = options.clear ?? ((id: number) => clearTimeout(id));
  let attempt = 0;
  let stopped = false;
  let open = false;
  let socket: WebSocket | null = null;
  let ping: number | null = null;
  let retry: number | null = null;
  const queue: ClientFrame[] = [];

  function clearPing(): void {
    if (ping === null) return;
    clear(ping);
    ping = null;
  }

  function pump(): void {
    if (!open || !socket || socket.readyState !== 1) return;
    while (queue.length > 0) {
      const frame = queue.shift();
      if (frame) socket.send(JSON.stringify(frame));
    }
  }

  function armPing(): void {
    clearPing();
    ping = schedule(() => {
      if (stopped || !open || !socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify(clientFrameSchema.parse({ type: "ping" })));
      armPing();
    }, 25_000);
  }

  function connect(): void {
    if (stopped) return;
    open = false;
    const ws = new WS(options.url);
    socket = ws;
    ws.addEventListener("open", () => {
      attempt = 0;
      open = true;
      armPing();
      pump();
    });
    ws.addEventListener("message", (event) => {
      let json: unknown;
      try {
        json = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = serverFrameSchema.safeParse(json);
      if (!parsed.success) return;
      if (parsed.data.type === "ready") options.onReady();
      options.onFrame(parsed.data);
    });
    ws.addEventListener("close", (event) => {
      open = false;
      clearPing();
      if (stopped) return;
      const code = "code" in event ? Number(event.code) : 1006;
      if (code === 4401) {
        options.onUnauthorized();
        return;
      }
      attempt += 1;
      retry = schedule(connect, reconnectDelayMs(attempt));
    });
  }

  connect();
  return {
    send(frame) {
      if (open && socket && socket.readyState === 1) socket.send(JSON.stringify(frame));
      else queue.push(frame);
    },
    close() {
      stopped = true;
      clearPing();
      if (retry !== null) clear(retry);
      socket?.close();
    },
  };
}
