import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reportListItemSchema } from "contracts";
import { buildApp } from "../src/app";
import { reports } from "../src/db/schema";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";

describe("reports", () => {
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
    const dialogId = opened.json().id as string;
    const aliceMessage = await send(alice.cookie, dialogId, "from alice");
    const bobMessage = await send(bob.cookie, dialogId, "from bob");
    return { alice, bob, dialogId, aliceMessage, bobMessage };
  }

  async function send(cookie: string, dialogId: string, body: string) {
    const response = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie },
      payload: { body, clientMsgId: randomUUID() },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; body: string };
  }

  function report(cookie: string | undefined, payload: unknown) {
    return app.inject({
      method: "POST",
      url: "/api/reports",
      headers: cookie ? { cookie } : {},
      payload,
    });
  }

  it("stores one report, lists newest first, and leaves the message visible", async () => {
    const { alice, bob, dialogId, aliceMessage } = await pair();
    const empty = await app.inject({
      method: "GET",
      url: "/api/reports",
      headers: { cookie: bob.cookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);

    const created = await report(bob.cookie, { messageId: aliceMessage.id, reason: "spam" });
    expect(created.statusCode).toBe(201);
    expect(reportListItemSchema.parse(created.json())).toMatchObject({
      messageId: aliceMessage.id,
      dialogId,
      peerUsername: "alice",
      body: "from alice",
      reason: "spam",
    });

    const secondMessage = await send(alice.cookie, dialogId, "later");
    const firstId = created.json().id as string;
    await app.db
      .update(reports)
      .set({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(reports.id, firstId));
    const newer = await report(bob.cookie, { messageId: secondMessage.id, reason: "other" });
    expect(newer.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/api/reports",
      headers: { cookie: bob.cookie },
    });
    expect(list.json().map((item: { id: string }) => item.id)).toEqual([newer.json().id, firstId]);

    const aliceList = await app.inject({
      method: "GET",
      url: "/api/reports",
      headers: { cookie: alice.cookie },
    });
    expect(aliceList.json()).toEqual([]);

    const history = await app.inject({
      method: "GET",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
    });
    expect(history.json().messages.map((message: { body: string }) => message.body)).toEqual([
      "from alice",
      "from bob",
      "later",
    ]);
  });

  it("rejects a repeat, an own message, a foreign dialog, and an unknown id", async () => {
    const { alice, bob, aliceMessage, bobMessage } = await pair();
    const carol = await registerUser(app, "carol");

    expect((await report(bob.cookie, { messageId: aliceMessage.id, reason: "spam" })).statusCode).toBe(201);
    const repeat = await report(bob.cookie, { messageId: aliceMessage.id, reason: "abuse" });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json()).toEqual({ error: "already_reported" });

    const own = await report(alice.cookie, { messageId: aliceMessage.id, reason: "spam" });
    expect(own.statusCode).toBe(403);
    expect(own.json()).toEqual({ error: "forbidden" });

    const foreign = await report(carol.cookie, { messageId: bobMessage.id, reason: "spam" });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: "not_found" });

    const missing = await report(bob.cookie, { messageId: randomUUID(), reason: "spam" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "not_found" });
  });

  it("rejects a bad body and a missing session", async () => {
    const { bob, aliceMessage } = await pair();
    const badId = await report(bob.cookie, { messageId: "nope", reason: "spam" });
    expect(badId.statusCode).toBe(400);
    expect(badId.json()).toEqual({ error: "validation_error", fields: { messageId: "invalid" } });

    const badReason = await report(bob.cookie, { messageId: aliceMessage.id, reason: "nope" });
    expect(badReason.statusCode).toBe(400);
    expect(badReason.json()).toEqual({ error: "validation_error", fields: { reason: "invalid" } });

    const missingReason = await report(bob.cookie, { messageId: aliceMessage.id });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json()).toEqual({ error: "validation_error", fields: { reason: "invalid" } });

    const anonymous = await report(undefined, { messageId: aliceMessage.id, reason: "spam" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "unauthorized" });

    const anonymousList = await app.inject({ method: "GET", url: "/api/reports" });
    expect(anonymousList.statusCode).toBe(401);
  });

  it("accepts a report while the dialog is blocked", async () => {
    const { alice, bob, aliceMessage } = await pair();
    const blocked = await app.inject({
      method: "POST",
      url: "/api/blocks",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    expect(blocked.statusCode).toBe(201);
    const created = await report(bob.cookie, { messageId: aliceMessage.id, reason: "abuse" });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ peerUsername: "alice", reason: "abuse" });
  });
});
