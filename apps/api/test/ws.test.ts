import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildApp } from "../src/app";
import { dialogCursors } from "../src/db/schema";
import { IDLE_MS } from "../src/gateway";
import { clearHub, flushHub } from "../src/services/hub";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";
import { closeQuiet, connect, isRecord, listenEphemeral, openClient, waitClose, waitFor } from "./ws";

describe("websocket idle constant", () => {
  it("keeps the production idle window at 90 seconds", () => {
    expect(IDLE_MS).toBe(90_000);
  });
});

describe("websocket", () => {
  let app: FastifyInstance;
  let port: number;
  const open: WebSocket[] = [];

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false });
    port = await listenEphemeral(app);
  });

  afterAll(async () => {
    await Promise.all(open.splice(0).map((ws) => closeQuiet(ws)));
    await flushHub();
    clearHub();
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all(open.splice(0).map((ws) => closeQuiet(ws)));
    await flushHub();
    clearHub();
    await resetDatabase(app.db);
  });

  async function pair() {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(opened.statusCode).toBe(201);
    return { alice, bob, dialogId: opened.json().id as string };
  }

  async function online(cookie: string) {
    const client = await openClient(port, cookie);
    open.push(client.ws);
    await waitFor(client.frames, (frame) => frame.type === "ready");
    return client;
  }

  it("closes a socket without a live session with 4401 and no text frames", async () => {
    const anonymous = connect(port);
    const anonymousFrames: unknown[] = [];
    anonymous.on("message", (data) => anonymousFrames.push(String(data)));
    expect(await waitClose(anonymous)).toBe(4401);
    expect(anonymousFrames).toEqual([]);

    const alice = await registerUser(app, "alice");
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: alice.cookie },
    });
    expect(logout.statusCode).toBe(204);
    const expired = connect(port, alice.cookie);
    expect(await waitClose(expired)).toBe(4401);

    const other = connect(port, undefined, "/nope");
    expect(await waitClose(other)).toBe(1006);
  });

  it("acks the sender on every socket and delivers message.new to the peer", async () => {
    const { alice, bob, dialogId } = await pair();
    const aliceSock = await online(alice.cookie);
    const bobSock = await online(bob.cookie);
    await waitFor(aliceSock.frames, (frame) => frame.type === "presence" && frame.online === true);
    const aliceSecond = await online(alice.cookie);
    await flushHub();
    expect(bobSock.frames.filter((frame) => isRecord(frame) && frame.type === "presence" && frame.online === true)).toHaveLength(1);

    const clientMsgId = randomUUID();
    aliceSock.ws.send(JSON.stringify({ type: "message.send", dialogId, body: "hello", clientMsgId }));
    const ack = await waitFor(aliceSock.frames, (frame) => frame.type === "message.ack");
    const secondAck = await waitFor(aliceSecond.frames, (frame) => frame.type === "message.ack");
    const incoming = await waitFor(bobSock.frames, (frame) => frame.type === "message.new");
    expect(ack).toMatchObject({
      type: "message.ack",
      dialogId,
      message: { body: "hello", senderId: alice.id, seq: 1, status: "sent" },
    });
    expect(secondAck).toMatchObject({ message: { body: "hello", status: "sent" } });
    expect(incoming).toMatchObject({
      type: "message.new",
      dialogId,
      message: { body: "hello", status: null },
    });
    expect(bobSock.frames.filter((frame) => isRecord(frame) && frame.type === "message.new")).toHaveLength(1);
  });

  it("moves delivery and read cursors and ignores a smaller seq", async () => {
    const { alice, bob, dialogId } = await pair();
    const aliceSock = await online(alice.cookie);
    const bobSock = await online(bob.cookie);
    const clientMsgId = randomUUID();
    aliceSock.ws.send(JSON.stringify({ type: "message.send", dialogId, body: "hello", clientMsgId }));
    await waitFor(bobSock.frames, (frame) => frame.type === "message.new");

    bobSock.ws.send(JSON.stringify({ type: "cursor.delivered", dialogId, seq: 1 }));
    const delivered = await waitFor(aliceSock.frames, (frame) => frame.type === "cursor.updated");
    expect(delivered).toEqual({
      type: "cursor.updated",
      dialogId,
      userId: bob.id,
      lastDeliveredSeq: 1,
      lastReadSeq: 0,
    });
    await waitFor(bobSock.frames, (frame) => frame.type === "cursor.updated");

    const before = bobSock.frames.length;
    bobSock.ws.send(JSON.stringify({ type: "cursor.delivered", dialogId, seq: 0 }));
    bobSock.ws.send(JSON.stringify({ type: "ping" }));
    await waitFor(bobSock.frames.slice(before), (frame) => frame.type === "pong");
    await flushHub();
    expect(bobSock.frames.slice(before).some((frame) => isRecord(frame) && frame.type === "cursor.updated")).toBe(false);
    const [stored] = await app.db
      .select()
      .from(dialogCursors)
      .where(and(eq(dialogCursors.dialogId, dialogId), eq(dialogCursors.userId, bob.id)));
    expect(stored).toMatchObject({ lastDeliveredSeq: 1, lastReadSeq: 0 });

    const readFrom = aliceSock.frames.length;
    bobSock.ws.send(JSON.stringify({ type: "cursor.read", dialogId, seq: 1 }));
    const read = await waitFor(aliceSock.frames.slice(readFrom), (frame) => frame.type === "cursor.updated");
    expect(read).toMatchObject({ userId: bob.id, lastDeliveredSeq: 1, lastReadSeq: 1 });

    const history = await app.inject({
      method: "GET",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
    });
    expect(history.json().messages[0]).toMatchObject({ status: "read" });
  });

  it("broadcasts the cursor raised by the latest history page", async () => {
    const { alice, bob, dialogId } = await pair();
    const aliceSock = await online(alice.cookie);
    await online(bob.cookie);
    const sent = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
      payload: { body: "http", clientMsgId: randomUUID() },
    });
    expect(sent.statusCode).toBe(201);
    const page = await app.inject({
      method: "GET",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: bob.cookie },
    });
    expect(page.statusCode).toBe(200);
    const frame = await waitFor(
      aliceSock.frames,
      (item) => item.type === "cursor.updated" && item.userId === bob.id,
    );
    expect(frame).toMatchObject({ lastDeliveredSeq: 1, lastReadSeq: 0 });
  });

  it("keeps the socket open after an error frame", async () => {
    const { alice, bob, dialogId } = await pair();
    const aliceSock = await online(alice.cookie);
    const bobSock = await online(bob.cookie);
    const clientMsgId = randomUUID();
    bobSock.ws.send("{");
    expect(await waitFor(bobSock.frames, (frame) => frame.type === "error")).toEqual({
      type: "error",
      code: "validation_error",
    });
    bobSock.ws.send(JSON.stringify({ type: "message.send", dialogId, body: "   ", clientMsgId }));
    expect(await waitFor(bobSock.frames, (frame) => frame.type === "error" && frame.clientMsgId === clientMsgId)).toEqual({
      type: "error",
      code: "validation_error",
      clientMsgId,
    });
    bobSock.ws.send(JSON.stringify({ type: "cursor.delivered", dialogId: randomUUID(), seq: 1 }));
    expect(await waitFor(bobSock.frames, (frame) => frame.code === "not_found")).toEqual({
      type: "error",
      code: "not_found",
    });

    const blocked = await app.inject({
      method: "POST",
      url: "/api/blocks",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(blocked.statusCode).toBe(201);
    const blockedId = randomUUID();
    bobSock.ws.send(JSON.stringify({ type: "message.send", dialogId, body: "nope", clientMsgId: blockedId }));
    expect(await waitFor(bobSock.frames, (frame) => frame.clientMsgId === blockedId)).toEqual({
      type: "error",
      code: "forbidden",
      clientMsgId: blockedId,
    });
    expect(aliceSock.frames.some((frame) => isRecord(frame) && frame.type === "message.new")).toBe(false);

    const pingFrom = bobSock.frames.length;
    bobSock.ws.send(JSON.stringify({ type: "ping" }));
    await waitFor(bobSock.frames.slice(pingFrom), (frame) => frame.type === "pong");
    expect(bobSock.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("websocket idle", () => {
  let app: FastifyInstance;
  let port: number;
  const open: WebSocket[] = [];

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false, idleMs: 600 });
    port = await listenEphemeral(app);
  });

  afterAll(async () => {
    await Promise.all(open.splice(0).map((ws) => closeQuiet(ws)));
    await flushHub();
    clearHub();
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all(open.splice(0).map((ws) => closeQuiet(ws)));
    await flushHub();
    clearHub();
    await resetDatabase(app.db);
  });

  it("closes a silent socket with 1000 and tells the peer they went offline", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(opened.statusCode).toBe(201);
    const aliceSock = await openClient(port, alice.cookie);
    const bobSock = await openClient(port, bob.cookie);
    open.push(aliceSock.ws, bobSock.ws);
    await waitFor(aliceSock.frames, (frame) => frame.type === "presence" && frame.userId === bob.id && frame.online === true);
    const keepAlive = setInterval(() => {
      if (aliceSock.ws.readyState === WebSocket.OPEN) aliceSock.ws.send(JSON.stringify({ type: "ping" }));
    }, 200);
    try {
      expect(await waitClose(bobSock.ws, 2000)).toBe(1000);
      await waitFor(
        aliceSock.frames,
        (frame) => frame.type === "presence" && frame.userId === bob.id && frame.online === false,
        2000,
      );
      expect(aliceSock.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
