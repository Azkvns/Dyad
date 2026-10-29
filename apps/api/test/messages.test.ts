import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { blocks, dialogs, messages } from "../src/db/schema";
import { hub } from "../src/services/hub";
import { withSeqRetry } from "../src/services/message-service";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";

describe("messages", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app.db);
  });

  async function openPair() {
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

  function send(cookie: string, dialogId: string, body: string, clientMsgId: string) {
    return app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie },
      payload: { body, clientMsgId },
    });
  }

  it("requires a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/dialogs/${randomUUID()}/messages`,
      payload: { body: "hi", clientMsgId: randomUUID() },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("hides a foreign dialog and an unknown id", async () => {
    const { alice, bob } = await openPair();
    const cara = await registerUser(app, "cara");
    const foreign = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: bob.cookie },
      payload: { username: "cara" },
    });
    const hidden = await send(alice.cookie, foreign.json().id as string, "hi", randomUUID());
    const missing = await send(alice.cookie, randomUUID(), "hi", randomUUID());
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ error: "not_found" });
    expect(missing.json()).toEqual({ error: "not_found" });
    expect(cara.username).toBe("cara");
  });

  it("rejects a path that is not a uuid", async () => {
    const { alice } = await openPair();
    const response = await send(alice.cookie, "not-a-uuid", "hi", randomUUID());
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "validation_error", fields: { id: "invalid" } });
  });

  it("sends once per client id and conflicts on a different body", async () => {
    const { alice, dialogId } = await openPair();
    const clientMsgId = randomUUID();
    const created = await send(alice.cookie, dialogId, "  hi  ", clientMsgId);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      seq: 1,
      senderId: alice.id,
      body: "hi",
      status: "sent",
    });
    const [dialog] = await app.db.select().from(dialogs).where(eq(dialogs.id, dialogId));
    expect(dialog?.lastSeq).toBe(1);

    const second = await send(alice.cookie, dialogId, "next", randomUUID());
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ seq: 2 });

    const replay = await send(alice.cookie, dialogId, "hi", clientMsgId);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id: created.json().id, seq: 1, body: "hi" });
    const stored = await app.db.select().from(messages);
    expect(stored).toHaveLength(2);
    const [afterReplay] = await app.db.select().from(dialogs).where(eq(dialogs.id, dialogId));
    expect(afterReplay?.lastSeq).toBe(2);

    const beforeConflict = await app.db.select().from(messages).where(eq(messages.clientMsgId, clientMsgId));
    const conflict = await send(alice.cookie, dialogId, "other", clientMsgId);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "conflict" });
    const afterConflict = await app.db.select().from(messages).where(eq(messages.clientMsgId, clientMsgId));
    expect(afterConflict).toEqual(beforeConflict);
  });

  it("rejects blank and oversized text before inserting", async () => {
    const { alice, dialogId } = await openPair();
    const blank = await send(alice.cookie, dialogId, "   ", randomUUID());
    const long = await send(alice.cookie, dialogId, "a".repeat(2001), randomUUID());
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: "validation_error", fields: { body: "too_short" } });
    expect(long.json()).toEqual({ error: "validation_error", fields: { body: "too_long" } });
    expect(await app.db.select().from(messages)).toHaveLength(0);
  });

  it("notifies both participants only when a row is inserted", async () => {
    const { alice, bob, dialogId } = await openPair();
    const calls: Array<{ userId: string; frame: { type: string; dialogId: string; message: { id: string; status: string | null } } }> = [];
    const previous = hub.send;
    hub.send = (userId, frame) => {
      if (frame.type === "message.ack" || frame.type === "message.new") {
        calls.push({ userId, frame });
      }
    };
    try {
      const clientMsgId = randomUUID();
      const created = await send(alice.cookie, dialogId, "hi", clientMsgId);
      expect(created.statusCode).toBe(201);
      const messageId = created.json().id as string;
      expect(calls).toEqual([
        {
          userId: alice.id,
          frame: {
            type: "message.ack",
            dialogId,
            message: expect.objectContaining({ id: messageId, status: "sent" }),
          },
        },
        {
          userId: bob.id,
          frame: {
            type: "message.new",
            dialogId,
            message: expect.objectContaining({ id: messageId, status: null }),
          },
        },
      ]);
      const replay = await send(alice.cookie, dialogId, "hi", clientMsgId);
      expect(replay.statusCode).toBe(200);
      expect(calls).toHaveLength(2);
    } finally {
      hub.send = previous;
    }
  });

  it("rejects a send when a block exists", async () => {
    const { alice, bob, dialogId } = await openPair();
    await app.db.insert(blocks).values({ blockerId: alice.id, blockedId: bob.id });
    const response = await send(alice.cookie, dialogId, "hi", randomUUID());
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
    expect(response.body).not.toContain("заблокир");
    expect(await app.db.select().from(messages)).toHaveLength(0);
  });

  it("returns internal after one exhausted seq collision", async () => {
    const { alice, bob, dialogId } = await openPair();
    await app.db.insert(messages).values({
      dialogId,
      senderId: bob.id,
      seq: 1,
      body: "planted",
      clientMsgId: randomUUID(),
    });
    const response = await send(alice.cookie, dialogId, "hi", randomUUID());
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal" });
    expect(response.body).not.toContain("messages_dialog_seq");
    const [dialog] = await app.db.select().from(dialogs).where(eq(dialogs.id, dialogId));
    expect(dialog?.lastSeq).toBe(0);
    const stored = await app.db.select().from(messages);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.body).toBe("planted");
  });
});

describe("withSeqRetry", () => {
  it("retries one dialog seq collision and does not retry other constraints", async () => {
    let calls = 0;
    const recovered = await withSeqRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw { code: "23505", constraint_name: "messages_dialog_seq_unique" };
      }
      return "ok";
    });
    expect(recovered).toBe("ok");
    expect(calls).toBe(2);

    calls = 0;
    await expect(
      withSeqRetry(async () => {
        calls += 1;
        throw { code: "23505", constraint_name: "messages_dialog_seq_unique" };
      }),
    ).rejects.toMatchObject({ code: "23505", constraint_name: "messages_dialog_seq_unique" });
    expect(calls).toBe(2);

    calls = 0;
    await expect(
      withSeqRetry(async () => {
        calls += 1;
        throw { code: "23505", constraint_name: "messages_client_msg_unique" };
      }),
    ).rejects.toMatchObject({ constraint_name: "messages_client_msg_unique" });
    expect(calls).toBe(1);
  });
});
