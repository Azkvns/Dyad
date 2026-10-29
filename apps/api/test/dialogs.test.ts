import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { blocks, dialogCursors, dialogs, messages } from "../src/db/schema";
import { hub } from "../src/services/hub";
import { resetDatabase, testDatabaseUrl } from "./helpers";
import { registerUser } from "./http";

describe("dialogs", () => {
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

  describe("lookup", () => {
    it("requires a session", async () => {
      const response = await app.inject({ method: "GET", url: "/api/users/lookup?username=bob" });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("finds a peer by exact username and ignores case", async () => {
      const alice = await registerUser(app, "alice");
      const bob = await registerUser(app, "bob");
      const exact = await app.inject({
        method: "GET",
        url: "/api/users/lookup?username=bob",
        headers: { cookie: alice.cookie },
      });
      const mixed = await app.inject({
        method: "GET",
        url: "/api/users/lookup?username=Bob",
        headers: { cookie: alice.cookie },
      });
      expect(exact.statusCode).toBe(200);
      expect(exact.json()).toEqual({ id: bob.id, username: "bob" });
      expect(mixed.statusCode).toBe(200);
      expect(mixed.json()).toEqual({ id: bob.id, username: "bob" });
    });

    it("returns not_found for an unknown username", async () => {
      const alice = await registerUser(app, "alice");
      const response = await app.inject({
        method: "GET",
        url: "/api/users/lookup?username=carol",
        headers: { cookie: alice.cookie },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "not_found" });
    });

    it("rejects a lookup of the caller's own username", async () => {
      const alice = await registerUser(app, "alice");
      const response = await app.inject({
        method: "GET",
        url: "/api/users/lookup?username=alice",
        headers: { cookie: alice.cookie },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "validation_error", fields: { username: "invalid" } });
    });

    it("rejects a username that is too short", async () => {
      const alice = await registerUser(app, "alice");
      const response = await app.inject({
        method: "GET",
        url: "/api/users/lookup?username=no",
        headers: { cookie: alice.cookie },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string; fields: { username: string } };
      expect(body.error).toBe("validation_error");
      expect(body.fields.username === "too_short" || body.fields.username === "invalid").toBe(true);
    });
  });

  describe("open", () => {
    async function openDialog(cookie: string, username: string) {
      return app.inject({
        method: "POST",
        url: "/api/dialogs",
        headers: { cookie },
        payload: { username },
      });
    }

    it("creates one dialog for a pair and reuses it", async () => {
      const alice = await registerUser(app, "alice");
      const bob = await registerUser(app, "bob");
      const first = await openDialog(alice.cookie, "bob");
      const second = await openDialog(alice.cookie, "bob");
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      const created = first.json();
      const again = second.json();
      expect(created.created).toBe(true);
      expect(again.created).toBe(false);
      expect(created.id).toBe(again.id);
      expect(created.peer).toEqual({ id: bob.id, username: "bob" });
      expect(created.peer).not.toHaveProperty("online");
      const rows = await app.db.select().from(dialogs);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userLow < rows[0]?.userHigh).toBe(true);
      expect([rows[0]?.userLow, rows[0]?.userHigh].sort()).toEqual([alice.id, bob.id].sort());
      const cursors = await app.db.select().from(dialogCursors);
      expect(cursors).toHaveLength(2);
      expect(cursors.every((cursor) => cursor.lastDeliveredSeq === 0 && cursor.lastReadSeq === 0)).toBe(true);
    });

    it("resolves a concurrent open to one dialog", async () => {
      const alice = await registerUser(app, "alice");
      const bob = await registerUser(app, "bob");
      const [fromAlice, fromBob] = await Promise.all([
        openDialog(alice.cookie, "bob"),
        openDialog(bob.cookie, "alice"),
      ]);
      expect([fromAlice.statusCode, fromBob.statusCode].sort()).toEqual([200, 201]);
      expect(fromAlice.json().id).toBe(fromBob.json().id);
      expect(await app.db.select().from(dialogs)).toHaveLength(1);
      expect(await app.db.select().from(dialogCursors)).toHaveLength(2);
    });

    it("rejects opening a dialog with yourself", async () => {
      const alice = await registerUser(app, "alice");
      const response = await openDialog(alice.cookie, "alice");
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "validation_error", fields: { username: "invalid" } });
      expect(await app.db.select().from(dialogs)).toHaveLength(0);
    });

    it("returns not_found for an unknown username", async () => {
      const alice = await registerUser(app, "alice");
      const response = await openDialog(alice.cookie, "carol");
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "not_found" });
    });

    it("requires a session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/dialogs",
        payload: { username: "bob" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("refuses to create a dialog when a block already exists", async () => {
      const alice = await registerUser(app, "alice");
      const bob = await registerUser(app, "bob");
      await app.db.insert(blocks).values({ blockerId: alice.id, blockedId: bob.id });
      const fromAlice = await openDialog(alice.cookie, "bob");
      const fromBob = await openDialog(bob.cookie, "alice");
      expect(fromAlice.statusCode).toBe(403);
      expect(fromBob.statusCode).toBe(403);
      expect(fromAlice.json()).toEqual({ error: "forbidden" });
      expect(fromBob.json()).toEqual({ error: "forbidden" });
      expect(fromAlice.body).not.toContain("заблокир");
      expect(fromBob.body).not.toContain("заблокир");
      expect(await app.db.select().from(dialogs)).toHaveLength(0);
    });

    it("returns the existing dialog as blocked after a later block", async () => {
      const alice = await registerUser(app, "alice");
      const bob = await registerUser(app, "bob");
      const created = await openDialog(alice.cookie, "bob");
      expect(created.statusCode).toBe(201);
      await app.db.insert(blocks).values({ blockerId: alice.id, blockedId: bob.id });
      const again = await openDialog(bob.cookie, "alice");
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({
        id: created.json().id,
        created: false,
        blocked: true,
        peer: { id: alice.id, username: "alice" },
      });
      expect(await app.db.select().from(dialogs)).toHaveLength(1);
    });
  });

  describe("list", () => {
    it("orders dialogs, previews, unread counts, and online flags", async () => {
      const alice = await registerUser(app, "alice");
      const bob = await registerUser(app, "bob");
      const cara = await registerUser(app, "cara");
      const dave = await registerUser(app, "dave");
      const withCara = await app.inject({
        method: "POST",
        url: "/api/dialogs",
        headers: { cookie: alice.cookie },
        payload: { username: "cara" },
      });
      const withBob = await app.inject({
        method: "POST",
        url: "/api/dialogs",
        headers: { cookie: alice.cookie },
        payload: { username: "bob" },
      });
      const caraDialogId = withCara.json().id as string;
      const bobDialogId = withBob.json().id as string;

      await app.db.insert(messages).values({
        dialogId: bobDialogId,
        senderId: bob.id,
        seq: 1,
        body: "from bob",
        clientMsgId: randomUUID(),
        createdAt: new Date("2026-10-29T18:00:00.000Z"),
      });
      await app.db.update(dialogs).set({ lastSeq: 1 }).where(eq(dialogs.id, bobDialogId));
      await app.db.insert(messages).values({
        dialogId: caraDialogId,
        senderId: alice.id,
        seq: 1,
        body: "from alice",
        clientMsgId: randomUUID(),
        createdAt: new Date("2026-10-29T19:00:00.000Z"),
      });
      await app.db.update(dialogs).set({ lastSeq: 1 }).where(eq(dialogs.id, caraDialogId));
      await app.db
        .update(dialogCursors)
        .set({ lastDeliveredSeq: 1 })
        .where(and(eq(dialogCursors.dialogId, caraDialogId), eq(dialogCursors.userId, cara.id)));

      const withDave = await app.inject({
        method: "POST",
        url: "/api/dialogs",
        headers: { cookie: alice.cookie },
        payload: { username: "dave" },
      });
      const daveDialogId = withDave.json().id as string;
      const previous = hub.socketCount;
      try {
        const listed = await app.inject({
          method: "GET",
          url: "/api/dialogs",
          headers: { cookie: alice.cookie },
        });
        expect(listed.statusCode).toBe(200);
        const items = listed.json() as Array<{
          id: string;
          peer: { id: string; username: string; online: boolean };
          lastMessage: { senderId: string; status: string | null; body: string } | null;
          unreadCount: number;
          blocked: boolean;
        }>;
        expect(items.map((item) => item.id)).toEqual([caraDialogId, bobDialogId, daveDialogId]);
        expect(items[0]?.lastMessage).toMatchObject({ senderId: alice.id, body: "from alice", status: "delivered" });
        expect(items[1]?.lastMessage).toMatchObject({ senderId: bob.id, body: "from bob", status: null });
        expect(items[2]?.lastMessage).toBeNull();
        expect(items.map((item) => item.unreadCount)).toEqual([0, 1, 0]);
        expect(items.every((item) => item.peer.online === false && item.blocked === false)).toBe(true);

        hub.socketCount = () => 1;
        const online = await app.inject({
          method: "GET",
          url: "/api/dialogs",
          headers: { cookie: alice.cookie },
        });
        expect(online.json().every((item: { peer: { online: boolean } }) => item.peer.online)).toBe(true);

        await app.db.insert(blocks).values({ blockerId: alice.id, blockedId: bob.id });
        const blocked = await app.inject({
          method: "GET",
          url: "/api/dialogs",
          headers: { cookie: alice.cookie },
        });
        const bobItem = blocked.json().find((item: { id: string }) => item.id === bobDialogId);
        const caraItem = blocked.json().find((item: { id: string }) => item.id === caraDialogId);
        expect(bobItem).toMatchObject({ blocked: true, peer: { id: bob.id, online: false } });
        expect(caraItem).toMatchObject({ blocked: false, peer: { id: cara.id, online: true } });
        expect(dave.id).toBeTypeOf("string");
      } finally {
        hub.socketCount = previous;
      }
    });

    it("returns an empty list for a user with no dialogs", async () => {
      const erin = await registerUser(app, "erin");
      const response = await app.inject({
        method: "GET",
        url: "/api/dialogs",
        headers: { cookie: erin.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it("requires a session to list dialogs", async () => {
      const response = await app.inject({ method: "GET", url: "/api/dialogs" });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });
  });
});
