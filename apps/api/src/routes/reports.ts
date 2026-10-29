import { createReportBodySchema, zodIssuesToFields } from "contracts";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../current-user";
import { HttpError } from "../http-error";
import { ReportService } from "../services/report-service";

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const reports = new ReportService(app.db);

  app.post("/", async (request, reply) => {
    const actor = await requireUser(app, request);
    const parsed = createReportBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const item = await reports.create(actor.userId, parsed.data.messageId, parsed.data.reason);
    return reply.status(201).send(item);
  });

  app.get("/", async (request, reply) => {
    const actor = await requireUser(app, request);
    return reply.send(await reports.list(actor.userId));
  });
}
