import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export function spaFallback(method: string, url: string): "index" | "missing" {
  const path = url.split("?")[0] ?? "/";
  if (method !== "GET" && method !== "HEAD") return "missing";
  if (path.startsWith("/api") || path.startsWith("/ws")) return "missing";
  if (path.includes(".")) return "missing";
  return "index";
}

export async function registerWeb(app: FastifyInstance, webDist: string | undefined): Promise<void> {
  if (!webDist) return;
  if (!existsSync(webDist)) {
    app.log.warn({ webDist }, "web dist missing");
    return;
  }
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (spaFallback(request.method, request.url) === "index") return reply.sendFile("index.html");
    return reply.status(404).send({ error: "not_found" });
  });
}
