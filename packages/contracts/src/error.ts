import { z } from "zod";

export const fieldErrorCodeSchema = z.enum(["too_short", "too_long", "invalid", "required"]);
export type FieldErrorCode = z.infer<typeof fieldErrorCodeSchema>;

export const errorSchema = z.object({
  error: z.string(),
  fields: z.record(z.string(), fieldErrorCodeSchema).optional(),
});

export function zodIssuesToFields(issues: readonly z.core.$ZodIssue[]): Record<string, FieldErrorCode> {
  const fields: Record<string, FieldErrorCode> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (!key || fields[key]) continue;
    fields[key] = fieldCode(issue);
  }
  return fields;
}

function fieldCode(issue: z.core.$ZodIssue): FieldErrorCode {
  if (issue.code === "too_small") return "too_short";
  if (issue.code === "too_big") return "too_long";
  if (issue.code === "invalid_type" && issue.input === undefined) return "required";
  return "invalid";
}
