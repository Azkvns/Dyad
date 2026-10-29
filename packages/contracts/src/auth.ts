import { z } from "zod";
import { passwordSchema } from "./password";
import { usernameSchema } from "./username";

export const registerBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginBodySchema = registerBodySchema;
