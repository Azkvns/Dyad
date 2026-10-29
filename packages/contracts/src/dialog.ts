import { z } from "zod";
import { messageViewSchema } from "./message";
import { storedUsernameSchema, usernameSchema } from "./username";

export const dialogPeerSchema = z.object({
  id: z.uuid(),
  username: storedUsernameSchema,
  online: z.boolean().optional(),
});

export const dialogListItemSchema = z.object({
  id: z.uuid(),
  peer: dialogPeerSchema.extend({ online: z.boolean() }),
  lastMessage: messageViewSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  blocked: z.boolean(),
});

export const openDialogBodySchema = z.object({
  username: usernameSchema,
});

export const openDialogSchema = z.object({
  id: z.uuid(),
  peer: z.object({
    id: z.uuid(),
    username: storedUsernameSchema,
  }),
  created: z.boolean(),
  blocked: z.boolean(),
});

export const dialogParamsSchema = z.object({
  id: z.uuid(),
});

export type DialogPeer = z.infer<typeof dialogPeerSchema>;
export type DialogListItem = z.infer<typeof dialogListItemSchema>;
export type OpenDialogBody = z.infer<typeof openDialogBodySchema>;
export type OpenDialog = z.infer<typeof openDialogSchema>;
export type DialogParams = z.infer<typeof dialogParamsSchema>;
