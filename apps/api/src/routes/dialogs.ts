import { openDialogBodySchema, zodIssuesToFields } from "contracts";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../current-user";
import { HttpError } from "../http-error";
import { DialogService } from "../services/dialog-service";

export async function dialogRoutes(app: FastifyInstance): Promise<void> {
  const dialogs = new DialogService(app.db);

  app.post("/", async (request, reply) => {
    const actor = await requireUser(app, request);
    const parsed = openDialogBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const { dialog, created } = await dialogs.open(actor.userId, parsed.data.username);
    return reply.status(created ? 201 : 200).send(dialog);
  });

  app.get("/", async (request, reply) => {
    const actor = await requireUser(app, request);
    return reply.send(await dialogs.list(actor.userId));
  });
}
