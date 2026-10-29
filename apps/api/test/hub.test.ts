import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CursorState, MessageView } from "contracts";
import { buildApp } from "../src/app";
import { clearHub, flushHub, hub } from "../src/services/hub";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";

const message: MessageView = {
  id: "00000000-0000-4000-8000-000000000001",
  seq: 1,
  senderId: "00000000-0000-4000-8000-000000000002",
  body: "hi",
  createdAt: "2026-10-29T18:00:00.000Z",
  status: "sent",
};

const cursor: CursorState = {
  dialogId: "00000000-0000-4000-8000-000000000003",
  userId: "00000000-0000-4000-8000-000000000002",
  lastDeliveredSeq: 1,
  lastReadSeq: 0,
};

function recorder() {
  const frames: unknown[] = [];
  const socket = {
    readyState: 1,
    send(data: string) {
      frames.push(JSON.parse(data));
    },
  };
  return { socket, frames };
}

describe("hub", () => {
  let app: FastifyInstance;
  const originalSocketCount = hub.socketCount;

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false });
  });

  afterAll(async () => {
    await flushHub();
    clearHub();
    await app.close();
  });

  beforeEach(async () => {
    await flushHub();
    clearHub();
    await resetDatabase(app.db);
  });

  afterEach(() => {
    hub.socketCount = originalSocketCount;
  });

  it("accepts a non-uuid attach and a missing dialog without throwing", async () => {
    expect(() => hub.attach("user", {})).not.toThrow();
    expect(() => hub.detach("user", {})).not.toThrow();
    expect(() => hub.send("user", { type: "message.ack", dialogId: cursor.dialogId, message })).not.toThrow();
    expect(() => hub.broadcastCursor(cursor.dialogId, cursor)).not.toThrow();
    await flushHub();
  });

  it("reports zero sockets and allows the counter to be replaced", () => {
    expect(hub.socketCount("any")).toBe(0);
    const previous = hub.socketCount;
    hub.socketCount = () => 1;
    try {
      expect(hub.socketCount("any")).toBe(1);
    } finally {
      hub.socketCount = previous;
    }
  });

  it("delivers one JSON frame to every open socket and drops a throwing socket", async () => {
    const userId = "00000000-0000-4000-8000-000000000010";
    const first = recorder();
    const second = recorder();
    const closed = recorder();
    closed.socket.readyState = 3;
    const boom = {
      readyState: 1,
      send() {
        throw new Error("boom");
      },
    };
    hub.attach(userId, first.socket);
    hub.attach(userId, second.socket);
    hub.attach(userId, closed.socket);
    hub.attach(userId, boom);
    hub.send(userId, { type: "message.ack", dialogId: cursor.dialogId, message });
    expect(first.frames).toEqual([{ type: "message.ack", dialogId: cursor.dialogId, message }]);
    expect(second.frames).toEqual(first.frames);
    expect(closed.frames).toEqual([]);
    expect(hub.socketCount(userId)).toBe(3);
    await flushHub();
  });

  it("fans a cursor update out to both participants", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(opened.statusCode).toBe(201);
    const dialogId = opened.json().id as string;
    const left = recorder();
    const right = recorder();
    hub.attach(alice.id, left.socket);
    hub.attach(bob.id, right.socket);
    await flushHub();
    left.frames.length = 0;
    right.frames.length = 0;
    const state: CursorState = { dialogId, userId: bob.id, lastDeliveredSeq: 1, lastReadSeq: 0 };
    hub.broadcastCursor(dialogId, state);
    await flushHub();
    const frame = { type: "cursor.updated", ...state };
    expect(left.frames).toContainEqual(frame);
    expect(right.frames).toContainEqual(frame);
  });

  it("emits presence only on the empty and full transitions", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    const dialogId = opened.json().id as string;
    const aliceSock = recorder();
    const bobSock = recorder();
    const bobSecond = recorder();
    hub.attach(alice.id, aliceSock.socket);
    hub.attach(bob.id, bobSock.socket);
    await flushHub();
    expect(aliceSock.frames).toContainEqual({ type: "presence", userId: bob.id, online: true });
    expect(bobSock.frames).toContainEqual({ type: "presence", userId: alice.id, online: true });

    hub.attach(bob.id, bobSecond.socket);
    await flushHub();
    expect(aliceSock.frames.filter((frame) => JSON.stringify(frame).includes("\"online\":true"))).toHaveLength(1);

    hub.detach(bob.id, bobSecond.socket);
    await flushHub();
    expect(aliceSock.frames.filter((frame) => JSON.stringify(frame).includes("\"online\":false"))).toHaveLength(0);

    hub.detach(bob.id, bobSock.socket);
    await flushHub();
    expect(aliceSock.frames).toContainEqual({ type: "presence", userId: bob.id, online: false });
    expect(dialogId).toBe(opened.json().id);
  });

  it("hides presence and list online when either side has blocked the other", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(opened.statusCode).toBe(201);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/blocks",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(blocked.statusCode).toBe(201);

    const aliceSock = recorder();
    const bobSock = recorder();
    hub.attach(alice.id, aliceSock.socket);
    hub.attach(bob.id, bobSock.socket);
    await flushHub();
    expect(aliceSock.frames).toEqual([]);
    expect(bobSock.frames).toEqual([]);

    const list = await app.inject({
      method: "GET",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
    });
    expect(list.json()[0]).toMatchObject({ blocked: true, peer: { online: false } });
    expect(hub.socketCount(bob.id)).toBe(1);
  });
});
