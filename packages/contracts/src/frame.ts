import { z } from "zod";
import { cursorBodySchema, cursorStateSchema } from "./cursor";
import { messageViewSchema, sendMessageBodySchema } from "./message";

export const clientFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message.send"),
    dialogId: z.uuid(),
    body: sendMessageBodySchema.shape.body,
    clientMsgId: sendMessageBodySchema.shape.clientMsgId,
  }),
  z.object({
    type: z.literal("cursor.delivered"),
    dialogId: z.uuid(),
    seq: cursorBodySchema.shape.seq,
  }),
  z.object({
    type: z.literal("cursor.read"),
    dialogId: z.uuid(),
    seq: cursorBodySchema.shape.seq,
  }),
  z.object({ type: z.literal("ping") }),
]);

export const serverFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("message.ack"),
    dialogId: z.uuid(),
    message: messageViewSchema,
  }),
  z.object({
    type: z.literal("message.new"),
    dialogId: z.uuid(),
    message: messageViewSchema,
  }),
  z.object({
    type: z.literal("cursor.updated"),
    dialogId: cursorStateSchema.shape.dialogId,
    userId: cursorStateSchema.shape.userId,
    lastDeliveredSeq: cursorStateSchema.shape.lastDeliveredSeq,
    lastReadSeq: cursorStateSchema.shape.lastReadSeq,
  }),
  z.object({
    type: z.literal("presence"),
    userId: z.uuid(),
    online: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    clientMsgId: z.uuid().optional(),
  }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
