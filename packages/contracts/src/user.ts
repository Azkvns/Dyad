import { z } from "zod";
import { storedUsernameSchema, usernameSchema } from "./username";

export const publicUserSchema = z.object({
  id: z.uuid(),
  username: storedUsernameSchema,
});

export const lookupQuerySchema = z.object({
  username: usernameSchema,
});

export type PublicUser = z.infer<typeof publicUserSchema>;
export type LookupQuery = z.infer<typeof lookupQuerySchema>;
