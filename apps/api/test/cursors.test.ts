import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { dialogCursors } from "../src/db/schema";
import { flushHub, hub } from "../src/services/hub";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";

describe("cursors", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await flushHub();
    await resetDatabase(app.db);
  });

  async function pairWithMessages() {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    const dialogId = opened.json().id as string;
    const firstId = randomUUID();
    const secondId = randomUUID();
    const first = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
      payload: { body: "one", clientMsgId: firstId },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
      payload: { body: "two", clientMsgId: secondId },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    return { alice, bob, dialogId, firstId, secondId };
  }

  function postCursor(cookie: string | undefined, dialogId: string, action: "delivered" | "read", seq: number) {
    return app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/${action}`,
      headers: cookie ? { cookie } : {},
      payload: { seq },
    });
  }

  async function cursorOf(dialogId: string, userId: string) {
    const rows = await app.db
      .select()
      .from(dialogCursors)
      .where(and(eq(dialogCursors.dialogId, dialogId), eq(dialogCursors.userId, userId)));
    return rows[0];
  }

  it("advances delivery without moving backward and lifts delivery on read", async () => {
    const { alice, bob, dialogId, secondId } = await pairWithMessages();
    const calls: Array<{ dialogId: string; state: { userId: string; lastDeliveredSeq: number; lastReadSeq: number } }> = [];
    const previous = hub.broadcastCursor;
    hub.broadcastCursor = (id, state) => {
      calls.push({ dialogId: id, state });
    };
    try {
      const delivered = await postCursor(bob.cookie, dialogId, "delivered", 1);
      expect(delivered.statusCode).toBe(204);
      expect(delivered.body).toBe("");
      expect(await cursorOf(dialogId, bob.id)).toMatchObject({ lastDeliveredSeq: 1, lastReadSeq: 0 });
      expect(calls).toEqual([
        { dialogId, state: { dialogId, userId: bob.id, lastDeliveredSeq: 1, lastReadSeq: 0 } },
      ]);

      const repeat = await postCursor(bob.cookie, dialogId, "delivered", 1);
      expect(repeat.statusCode).toBe(204);
      expect(await cursorOf(dialogId, bob.id)).toMatchObject({ lastDeliveredSeq: 1, lastReadSeq: 0 });
      expect(calls).toHaveLength(1);

      const ahead = await postCursor(bob.cookie, dialogId, "delivered", 2);
      expect(ahead.statusCode).toBe(204);
      const late = await postCursor(bob.cookie, dialogId, "delivered", 1);
      expect(late.statusCode).toBe(204);
      expect(await cursorOf(dialogId, bob.id)).toMatchObject({ lastDeliveredSeq: 2, lastReadSeq: 0 });

      const read = await postCursor(bob.cookie, dialogId, "read", 2);
      expect(read.statusCode).toBe(204);
      expect(await cursorOf(dialogId, bob.id)).toMatchObject({ lastDeliveredSeq: 2, lastReadSeq: 2 });

      const tooHigh = await postCursor(bob.cookie, dialogId, "delivered", 3);
      const negative = await postCursor(bob.cookie, dialogId, "read", -1);
      expect(tooHigh.statusCode).toBe(400);
      expect(tooHigh.json()).toEqual({ error: "validation_error", fields: { seq: "invalid" } });
      expect(negative.statusCode).toBe(400);
      expect(negative.json()).toEqual({ error: "validation_error", fields: { seq: "too_short" } });
      expect(await cursorOf(dialogId, bob.id)).toMatchObject({ lastDeliveredSeq: 2, lastReadSeq: 2 });

      const replay = await app.inject({
        method: "POST",
        url: `/api/dialogs/${dialogId}/messages`,
        headers: { cookie: alice.cookie },
        payload: { body: "two", clientMsgId: secondId },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ status: "read" });
      const listed = await app.inject({
        method: "GET",
        url: "/api/dialogs",
        headers: { cookie: alice.cookie },
      });
      expect(listed.json()[0].lastMessage.status).toBe("read");

      const bobBefore = await cursorOf(dialogId, bob.id);
      const aliceDelivered = await postCursor(alice.cookie, dialogId, "delivered", 2);
      expect(aliceDelivered.statusCode).toBe(204);
      expect(await cursorOf(dialogId, bob.id)).toEqual(bobBefore);
    } finally {
      hub.broadcastCursor = previous;
    }
  });

  it("does not move cursors for a foreign dialog", async () => {
    const { alice, bob, dialogId } = await pairWithMessages();
    const cara = await registerUser(app, "cara");
    const foreign = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: bob.cookie },
      payload: { username: "cara" },
    });
    const before = await app.db.select().from(dialogCursors);
    const response = await postCursor(alice.cookie, foreign.json().id as string, "delivered", 1);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    expect(await app.db.select().from(dialogCursors)).toEqual(before);
    expect(cara.id).not.toBe(dialogId);
  });

  it("requires a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/dialogs/${randomUUID()}/delivered`,
      payload: { seq: 1 },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });
});
