import { z } from "zod";

export const passwordSchema = z.string().min(8).superRefine((value, ctx) => {
  if (new TextEncoder().encode(value).length > 72) {
    ctx.addIssue({
      code: "too_big",
      origin: "string",
      maximum: 72,
      inclusive: true,
      message: "too_long",
    });
  }
});
