import { z } from "zod";

export const cursorBodySchema = z.object({
  seq: z.number().int().nonnegative(),
});

export const cursorStateSchema = z.object({
  dialogId: z.uuid(),
  userId: z.uuid(),
  lastDeliveredSeq: z.number().int().nonnegative(),
  lastReadSeq: z.number().int().nonnegative(),
});

export type CursorBody = z.infer<typeof cursorBodySchema>;
export type CursorState = z.infer<typeof cursorStateSchema>;
