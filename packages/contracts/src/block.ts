import { z } from "zod";
import { storedUsernameSchema, usernameSchema } from "./username";

export const blockBodySchema = z.object({
  username: usernameSchema,
});

export const blockListItemSchema = z.object({
  username: storedUsernameSchema,
});

export const blockParamsSchema = z.object({
  username: usernameSchema,
});

export type BlockBody = z.infer<typeof blockBodySchema>;
export type BlockListItem = z.infer<typeof blockListItemSchema>;
export type BlockParams = z.infer<typeof blockParamsSchema>;
