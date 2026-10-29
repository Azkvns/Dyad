import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { blocks, dialogs } from "../src/db/schema";
import { flushHub, hub } from "../src/services/hub";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";

describe("blocks", () => {
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

  function postBlock(cookie: string | undefined, username: string) {
    return app.inject({
      method: "POST",
      url: "/api/blocks",
      headers: cookie ? { cookie } : {},
      payload: { username },
    });
  }

  it("creates a block once and lists only the caller's blocks", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const cara = await registerUser(app, "cara");
    const created = await postBlock(alice.cookie, "Bob");
    expect(created.statusCode).toBe(201);
    expect(created.body).toBe("");
    expect(await app.db.select().from(blocks)).toHaveLength(1);

    const repeat = await postBlock(alice.cookie, "bob");
    expect(repeat.statusCode).toBe(204);
    expect(repeat.body).toBe("");
    expect(await app.db.select().from(blocks)).toHaveLength(1);

    const aliceList = await app.inject({
      method: "GET",
      url: "/api/blocks",
      headers: { cookie: alice.cookie },
    });
    const bobList = await app.inject({
      method: "GET",
      url: "/api/blocks",
      headers: { cookie: bob.cookie },
    });
    expect(aliceList.json()).toEqual([{ username: "bob" }]);
    expect(bobList.json()).toEqual([]);

    await app.db.delete(blocks);
    const first = await postBlock(alice.cookie, "cara");
    const second = await postBlock(alice.cookie, "bob");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const ordered = await app.inject({
      method: "GET",
      url: "/api/blocks",
      headers: { cookie: alice.cookie },
    });
    expect(ordered.json()).toEqual([{ username: "bob" }, { username: "cara" }]);
    expect(cara.username).toBe("cara");
  });

  it("rejects self, unknown users, and a missing session", async () => {
    const alice = await registerUser(app, "alice");
    const self = await postBlock(alice.cookie, "alice");
    const missing = await postBlock(alice.cookie, "cara");
    const anonymous = await postBlock(undefined, "alice");
    expect(self.statusCode).toBe(400);
    expect(self.json()).toEqual({ error: "validation_error", fields: { username: "invalid" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "not_found" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "unauthorized" });
  });

  it("deletes a block, a repeat, and an unknown username", async () => {
    const alice = await registerUser(app, "alice");
    await registerUser(app, "bob");
    const created = await postBlock(alice.cookie, "bob");
    expect(created.statusCode).toBe(201);
    const removed = await app.inject({
      method: "DELETE",
      url: "/api/blocks/bob",
      headers: { cookie: alice.cookie },
    });
    expect(removed.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: "/api/blocks",
      headers: { cookie: alice.cookie },
    });
    expect(list.json()).toEqual([]);
    const again = await app.inject({
      method: "DELETE",
      url: "/api/blocks/bob",
      headers: { cookie: alice.cookie },
    });
    const unknown = await app.inject({
      method: "DELETE",
      url: "/api/blocks/cara",
      headers: { cookie: alice.cookie },
    });
    expect(again.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(204);
  });

  it("refuses to open a dialog after a block", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    expect((await postBlock(alice.cookie, "bob")).statusCode).toBe(201);
    const fromAlice = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    const fromBob = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: bob.cookie },
      payload: { username: "alice" },
    });
    expect(fromAlice.statusCode).toBe(403);
    expect(fromBob.statusCode).toBe(403);
    expect(await app.db.select().from(dialogs)).toHaveLength(0);
  });

  it("keeps history visible and stops new messages until the block is removed", async () => {
    const alice = await registerUser(app, "alice");
    const bob = await registerUser(app, "bob");
    const opened = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: alice.cookie },
      payload: { username: "bob" },
    });
    const dialogId = opened.json().id as string;
    const sent = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
      payload: { body: "hi", clientMsgId: randomUUID() },
    });
    expect(sent.statusCode).toBe(201);
    expect((await postBlock(alice.cookie, "bob")).statusCode).toBe(201);

    const again = await app.inject({
      method: "POST",
      url: "/api/dialogs",
      headers: { cookie: bob.cookie },
      payload: { username: "alice" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ blocked: true, created: false });

    const denied = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
      payload: { body: "later", clientMsgId: randomUUID() },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "forbidden" });
    expect(denied.body).not.toContain("заблокир");

    const history = await app.inject({
      method: "GET",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: bob.cookie },
    });
    expect(history.json().messages).toEqual([expect.objectContaining({ body: "hi" })]);

    const previous = hub.socketCount;
    hub.socketCount = () => 1;
    try {
      const aliceList = await app.inject({
        method: "GET",
        url: "/api/dialogs",
        headers: { cookie: alice.cookie },
      });
      const bobList = await app.inject({
        method: "GET",
        url: "/api/dialogs",
        headers: { cookie: bob.cookie },
      });
      expect(aliceList.json()[0]).toMatchObject({ blocked: true, peer: { online: false } });
      expect(bobList.json()[0]).toMatchObject({ blocked: true, peer: { online: false } });
    } finally {
      hub.socketCount = previous;
    }

    const removed = await app.inject({
      method: "DELETE",
      url: "/api/blocks/bob",
      headers: { cookie: alice.cookie },
    });
    expect(removed.statusCode).toBe(204);
    const next = await app.inject({
      method: "POST",
      url: `/api/dialogs/${dialogId}/messages`,
      headers: { cookie: alice.cookie },
      payload: { body: "again", clientMsgId: randomUUID() },
    });
    expect(next.statusCode).toBe(201);
  });
});
