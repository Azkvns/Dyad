import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
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
});
