import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { createDatabase, type AppDatabase } from "./db/client";
import { HttpError } from "./http-error";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";

declare module "fastify" {
  interface FastifyInstance {
    db: AppDatabase;
  }
}

export async function buildApp(options: {
  databaseUrl: string;
  logger: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger });
  const database = createDatabase(options.databaseUrl);
  app.decorate("db", database.db);
  app.addHook("onClose", async () => {
    await database.close();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(error.body);
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: "internal" });
  });
  await app.register(cookie);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(userRoutes, { prefix: "/api/users" });
  if (process.env.NODE_ENV === "test") {
    app.get("/__test/boom", async () => {
      throw new Error("relation users does not exist");
    });
  }
  return app;
}
