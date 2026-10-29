import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createReportBodySchema, reportListItemSchema, zodIssuesToFields } from "./index";

const id = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";

function fields(
  schema: { safeParse: (input: unknown) => { success: boolean; error?: { issues: readonly z.core.$ZodIssue[] } } },
  input: unknown,
) {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success || !parsed.error) throw new Error("expected failure");
  return zodIssuesToFields(parsed.error.issues);
}

describe("report contracts", () => {
  it("accepts a list item and the three reasons", () => {
    expect(createReportBodySchema.parse({ messageId, reason: "abuse" })).toEqual({
      messageId,
      reason: "abuse",
    });
    expect(
      reportListItemSchema.parse({
        id,
        messageId,
        dialogId: id,
        peerUsername: "bob",
        body: "hi",
        reason: "spam",
        createdAt: "2026-10-29T18:00:00.000Z",
      }).peerUsername,
    ).toBe("bob");
  });

  it("maps invalid ids and reasons through the existing field codes", () => {
    expect(fields(createReportBodySchema, { reason: "spam" })).toEqual({ messageId: "required" });
    expect(fields(createReportBodySchema, { messageId: "nope", reason: "spam" })).toEqual({
      messageId: "invalid",
    });
    expect(fields(createReportBodySchema, { messageId })).toEqual({ reason: "invalid" });
    expect(fields(createReportBodySchema, { messageId, reason: "nope" })).toEqual({ reason: "invalid" });
  });
});
