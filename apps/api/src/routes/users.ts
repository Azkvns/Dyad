import { lookupQuerySchema, zodIssuesToFields } from "contracts";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../current-user";
import { HttpError } from "../http-error";
import { UserService } from "../services/user-service";

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const users = new UserService(app.db);

  app.get("/lookup", async (request, reply) => {
    const actor = await requireUser(app, request);
    const parsed = lookupQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const user = await users.lookup(actor.userId, parsed.data.username);
    return reply.status(200).send(user);
  });
}
