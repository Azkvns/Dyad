import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { spaFallback } from "../src/web-dist";
import { testDatabaseUrl } from "./helpers";

describe("spa fallback", () => {
  it("keeps API paths and dotted files off the HTML shell", () => {
    expect(spaFallback("GET", "/dialogs/33333333-3333-4333-8333-333333333333")).toBe("index");
    expect(spaFallback("GET", "/api/auth/me")).toBe("missing");
    expect(spaFallback("GET", "/assets/missing.js")).toBe("missing");
    expect(spaFallback("POST", "/dialogs")).toBe("missing");
  });
});

describe("web dist", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dyad-web-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>Dyad</title>");
    await writeFile(path.join(root, "assets", "app.js"), "console.log('dyad')");
    app = await buildApp({ databaseUrl: testDatabaseUrl(), logger: false, webDist: root });
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the shell, the asset, and the API on one origin", async () => {
    const shell = await app.inject({ method: "GET", url: "/dialogs/33333333-3333-4333-8333-333333333333" });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain("<title>Dyad</title>");
    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("console.log");
    const missing = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "not_found" });
    const me = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toEqual({ error: "unauthorized" });
  });
});
