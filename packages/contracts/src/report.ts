import { z } from "zod";
import { storedUsernameSchema } from "./username";

export const reportReasonSchema = z.enum(["spam", "abuse", "other"]);

export const createReportBodySchema = z.object({
  messageId: z.uuid(),
  reason: reportReasonSchema,
});

export const reportListItemSchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  dialogId: z.uuid(),
  peerUsername: storedUsernameSchema,
  body: z.string(),
  reason: reportReasonSchema,
  createdAt: z.iso.datetime(),
});

export type ReportReason = z.infer<typeof reportReasonSchema>;
export type CreateReportBody = z.infer<typeof createReportBodySchema>;
export type ReportListItem = z.infer<typeof reportListItemSchema>;
