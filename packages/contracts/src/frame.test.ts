import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clientFrameSchema, serverFrameSchema, zodIssuesToFields } from "./index";

const id = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";

function fields(
  schema: { safeParse: (input: unknown) => { success: boolean; error?: { issues: readonly z.core.$ZodIssue[] } } },
  input: unknown,
) {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success || !parsed.error) throw new Error("expected failure");
  return zodIssuesToFields(parsed.error.issues);
}

describe("frame contracts", () => {
  it("trims a message.send body and accepts ping", () => {
    expect(
      clientFrameSchema.parse({
        type: "message.send",
        dialogId: id,
        body: "  hi  ",
        clientMsgId: userId,
      }),
    ).toEqual({ type: "message.send", dialogId: id, body: "hi", clientMsgId: userId });
    expect(clientFrameSchema.parse({ type: "ping", extra: true })).toEqual({ type: "ping" });
  });

  it("rejects a blank body, a short seq, and an unknown type", () => {
    expect(fields(clientFrameSchema, { type: "message.send", dialogId: id, body: "   ", clientMsgId: userId })).toEqual({
      body: "too_short",
    });
    expect(fields(clientFrameSchema, { type: "cursor.delivered", dialogId: id, seq: -1 })).toEqual({
      seq: "too_short",
    });
    expect(fields(clientFrameSchema, { type: "cursor.read", dialogId: id })).toEqual({ seq: "required" });
    expect(fields(clientFrameSchema, { type: "cursor.read", dialogId: id, seq: 1.5 })).toEqual({ seq: "required" });
    expect(fields(clientFrameSchema, { type: "nope" })).toEqual({ type: "invalid" });
  });

  it("accepts ready, a nullable message status, presence, and an error without clientMsgId", () => {
    const message = {
      id,
      seq: 1,
      senderId: userId,
      body: "hi",
      createdAt: "2026-10-29T18:00:00.000Z",
      status: null,
    };
    expect(serverFrameSchema.parse({ type: "ready" })).toEqual({ type: "ready" });
    expect(serverFrameSchema.parse({ type: "pong" })).toEqual({ type: "pong" });
    expect(serverFrameSchema.parse({ type: "message.new", dialogId: id, message })).toMatchObject({
      type: "message.new",
      message: { status: null },
    });
    expect(serverFrameSchema.parse({ type: "presence", userId, online: true })).toEqual({
      type: "presence",
      userId,
      online: true,
    });
    expect(serverFrameSchema.parse({ type: "error", code: "forbidden" })).toEqual({
      type: "error",
      code: "forbidden",
    });
    expect(
      serverFrameSchema.parse({
        type: "cursor.updated",
        dialogId: id,
        userId,
        lastDeliveredSeq: 1,
        lastReadSeq: 0,
      }),
    ).toMatchObject({ lastReadSeq: 0 });
  });
});
