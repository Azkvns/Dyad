import { z } from "zod";
import { storedUsernameSchema } from "./username";

export const publicUserSchema = z.object({
  id: z.uuid(),
  username: storedUsernameSchema,
});
