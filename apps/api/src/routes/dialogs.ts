import {
  cursorBodySchema,
  dialogParamsSchema,
  historyQuerySchema,
  openDialogBodySchema,
  sendMessageBodySchema,
  zodIssuesToFields,
} from "contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../current-user";
import { HttpError } from "../http-error";
import { CursorService } from "../services/cursor-service";
import { DialogService } from "../services/dialog-service";
import { MessageService } from "../services/message-service";

export async function dialogRoutes(app: FastifyInstance): Promise<void> {
  const dialogs = new DialogService(app.db);
  const messageService = new MessageService(app.db);
  const cursors = new CursorService(app.db);

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

  app.post("/:id/messages", async (request, reply) => {
    const actor = await requireUser(app, request);
    const params = dialogParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(params.error.issues),
      });
    }
    const parsed = sendMessageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const { message, created } = await messageService.send(
      actor.userId,
      params.data.id,
      parsed.data.body,
      parsed.data.clientMsgId,
    );
    return reply.status(created ? 201 : 200).send(message);
  });

  app.get("/:id/messages", async (request, reply) => {
    const actor = await requireUser(app, request);
    const params = dialogParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(params.error.issues),
      });
    }
    const query = historyQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(query.error.issues),
      });
    }
    return reply.send(
      await messageService.history(actor.userId, params.data.id, query.data.beforeSeq ?? null, query.data.limit),
    );
  });

  app.post("/:id/delivered", async (request, reply) => {
    return moveCursor(request, reply, "delivered");
  });

  app.post("/:id/read", async (request, reply) => {
    return moveCursor(request, reply, "read");
  });

  async function moveCursor(request: FastifyRequest, reply: FastifyReply, kind: "delivered" | "read") {
    const actor = await requireUser(app, request);
    const params = dialogParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(params.error.issues),
      });
    }
    const parsed = cursorBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    if (kind === "delivered") await cursors.delivered(actor.userId, params.data.id, parsed.data.seq);
    else await cursors.read(actor.userId, params.data.id, parsed.data.seq);
    return reply.status(204).send();
  }
}
