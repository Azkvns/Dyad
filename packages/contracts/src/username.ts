import { z } from "zod";

export const storedUsernameSchema = z.string().regex(/^[a-z0-9_]{3,24}$/);

export const usernameSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().min(3).max(24).regex(/^[a-z0-9_]+$/));
