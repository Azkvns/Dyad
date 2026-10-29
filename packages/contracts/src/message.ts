import { z } from "zod";

export const messageStatusSchema = z.enum(["sent", "delivered", "read"]);

export const messageViewSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().nonnegative(),
  senderId: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  status: messageStatusSchema.nullable(),
});

export const sendMessageBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  clientMsgId: z.uuid(),
});

export const historyQuerySchema = z.object({
  beforeSeq: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().nonnegative().optional(),
  ),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const historyPageSchema = z.object({
  messages: z.array(messageViewSchema),
  nextBeforeSeq: z.number().int().positive().nullable(),
});

export type MessageStatus = z.infer<typeof messageStatusSchema>;
export type MessageView = z.infer<typeof messageViewSchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type HistoryPage = z.infer<typeof historyPageSchema>;
