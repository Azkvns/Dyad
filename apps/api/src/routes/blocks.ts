import { blockBodySchema, blockParamsSchema, zodIssuesToFields } from "contracts";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../current-user";
import { HttpError } from "../http-error";
import { BlockService } from "../services/block-service";

export async function blockRoutes(app: FastifyInstance): Promise<void> {
  const blocks = new BlockService(app.db);

  app.post("/", async (request, reply) => {
    const actor = await requireUser(app, request);
    const parsed = blockBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const { created } = await blocks.block(actor.userId, parsed.data.username);
    return reply.status(created ? 201 : 204).send();
  });

  app.delete("/:username", async (request, reply) => {
    const actor = await requireUser(app, request);
    const params = blockParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(params.error.issues),
      });
    }
    await blocks.unblock(actor.userId, params.data.username);
    return reply.status(204).send();
  });

  app.get("/", async (request, reply) => {
    const actor = await requireUser(app, request);
    return reply.send(await blocks.list(actor.userId));
  });
}
