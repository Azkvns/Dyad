import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { sessions, users } from "../src/db/schema";
import { listenOptions } from "../src/listen";
import { sessionCookieOptions } from "../src/session-cookie";
import { resetDatabase, testDatabaseUrl } from "./helpers";

function sessionCookie(response: { headers: Record<string, string | string[] | undefined> }) {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
  const match = /dyad_session=([^;]+)/.exec(header);
  if (!match?.[1]) throw new Error(`missing dyad_session: ${header}`);
  return { token: decodeURIComponent(match[1]), header };
}

describe("session cookie options", () => {
  it("sets Secure only in production", () => {
    expect(sessionCookieOptions("production").secure).toBe(true);
    expect(sessionCookieOptions("test")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2_592_000,
      secure: false,
    });
  });
});

describe("auth", () => {
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

  it("registers, logs in, reads me, and logs out", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Alice", password: "password1" },
    });
    expect(registered.statusCode).toBe(201);
    const created = registered.json();
    expect(created).toEqual({ id: expect.any(String), username: "alice" });
    expect(JSON.parse(registered.body)).not.toHaveProperty("password");
    expect(JSON.parse(registered.body)).not.toHaveProperty("token");

    const first = sessionCookie(registered);
    expect(first.header).toContain("HttpOnly");
    expect(first.header).toContain("SameSite=Lax");
    expect(first.header).toContain("Path=/");
    expect(first.header).toContain("Max-Age=2592000");
    expect(first.header).not.toContain("Secure");

    const [stored] = await app.db.select().from(sessions);
    expect(stored?.tokenHash).toBe(createHash("sha256").update(first.token).digest("hex"));
    expect(stored?.tokenHash).not.toBe(first.token);
    const lifetime = (stored?.expiresAt.getTime() ?? 0) - Date.now();
    expect(lifetime).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(lifetime).toBeLessThan(31 * 24 * 60 * 60 * 1000);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `dyad_session=${first.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual(created);

    const [afterMe] = await app.db.select().from(sessions);
    expect(afterMe?.expiresAt).toEqual(stored?.expiresAt);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: `dyad_session=${first.token}` },
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(loggedOut.body).toBe("");
    const cleared = String(loggedOut.headers["set-cookie"]);
    expect(cleared).toContain("dyad_session=");
    expect(cleared).toMatch(/Max-Age=0|Expires=/);

    const meAfter = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `dyad_session=${first.token}` },
    });
    expect(meAfter.statusCode).toBe(401);
    expect(meAfter.json()).toEqual({ error: "unauthorized" });
    expect(await app.db.select().from(sessions)).toEqual([]);

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ALICE", password: "password1" },
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.json()).toEqual(created);
    expect(sessionCookie(loggedIn).token).not.toBe(first.token);
  });

  it("returns the same 401 for an unknown login and a wrong password", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "password1" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody_user", password: "password1" },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "password2" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual({ error: "invalid_credentials" });
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("rejects a taken username and ignores case", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Alice", password: "password1" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "otherpass1" },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "username_taken" });
    const rows = await app.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.username).toBe("alice");
  });

  it("rejects logout and me without a session", async () => {
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout" });
    const me = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(logout.statusCode).toBe(401);
    expect(me.statusCode).toBe(401);
    expect(logout.json()).toEqual({ error: "unauthorized" });
    expect(me.json()).toEqual({ error: "unauthorized" });
  });

  it("returns validation_error for password length and username shape", async () => {
    const short = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "short" },
    });
    const long = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "я".repeat(37) },
    });
    const badName = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "bad-name", password: "password1" },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice" },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({ error: "validation_error", fields: { password: "too_short" } });
    expect(long.json()).toEqual({ error: "validation_error", fields: { password: "too_long" } });
    expect(badName.json()).toEqual({ error: "validation_error", fields: { username: "invalid" } });
    expect(missing.json()).toEqual({ error: "validation_error", fields: { password: "required" } });
    expect(short.body).not.toContain("stack");
  });

  it("accepts a password of exactly 72 utf-8 bytes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "a".repeat(72) },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ username: "alice" });
  });

  it("hides unhandled failures behind internal", async () => {
    const response = await app.inject({ method: "GET", url: "/__test/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal" });
    expect(response.body).not.toContain("users");
    expect(response.body).not.toContain("relation");
  });

  it("listens on 0.0.0.0", async () => {
    const listening = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false });
    await listening.listen(listenOptions({ PORT: 0 }));
    expect(listening.server.address()).toMatchObject({ address: "0.0.0.0" });
    await listening.close();
  });
});
