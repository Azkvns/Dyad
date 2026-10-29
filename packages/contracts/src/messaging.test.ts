import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cursorBodySchema,
  dialogListItemSchema,
  historyQuerySchema,
  messageViewSchema,
  openDialogBodySchema,
  openDialogSchema,
  sendMessageBodySchema,
  zodIssuesToFields,
} from "./index";

const id = "00000000-0000-4000-8000-000000000001";
const senderId = "00000000-0000-4000-8000-000000000002";

function fields(schema: { safeParse: (input: unknown) => { success: boolean; error?: { issues: readonly z.core.$ZodIssue[] } } }, input: unknown) {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success || !parsed.error) throw new Error("expected failure");
  return zodIssuesToFields(parsed.error.issues);
}

describe("messaging contracts", () => {
  it("lowercases the username inside an open-dialog body", () => {
    expect(openDialogBodySchema.parse({ username: "Bob" })).toEqual({ username: "bob" });
  });

  it("trims a message body", () => {
    expect(sendMessageBodySchema.parse({ body: "  hi  ", clientMsgId: id }).body).toBe("hi");
  });

  it("rejects blank, oversized, and malformed send bodies", () => {
    expect(fields(sendMessageBodySchema, { body: "   ", clientMsgId: id })).toEqual({ body: "too_short" });
    expect(fields(sendMessageBodySchema, { body: "a".repeat(2001), clientMsgId: id })).toEqual({ body: "too_long" });
    expect(fields(sendMessageBodySchema, { body: "hi", clientMsgId: "not-a-uuid" })).toEqual({
      clientMsgId: "invalid",
    });
  });

  it("parses history query defaults and bounds", () => {
    expect(historyQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(historyQuerySchema.parse({ beforeSeq: "4", limit: "2" })).toEqual({ beforeSeq: 4, limit: 2 });
    expect(fields(historyQuerySchema, { limit: "0" })).toEqual({ limit: "too_short" });
    expect(fields(historyQuerySchema, { limit: "101" })).toEqual({ limit: "too_long" });
    expect(fields(historyQuerySchema, { beforeSeq: "-1" })).toEqual({ beforeSeq: "too_short" });
  });

  it("rejects a negative or missing cursor seq", () => {
    expect(fields(cursorBodySchema, { seq: -1 })).toEqual({ seq: "too_short" });
    expect(fields(cursorBodySchema, {})).toEqual({ seq: "required" });
  });

  it("accepts a message view with a null status", () => {
    expect(
      messageViewSchema.parse({
        id,
        seq: 1,
        senderId,
        body: "hi",
        createdAt: "2026-10-29T18:00:00.000Z",
        status: null,
      }),
    ).toEqual({
      id,
      seq: 1,
      senderId,
      body: "hi",
      createdAt: "2026-10-29T18:00:00.000Z",
      status: null,
    });
  });

  it("requires online on a dialog list item and allows an open dialog without it", () => {
    const message = {
      id,
      seq: 1,
      senderId,
      body: "hi",
      createdAt: "2026-10-29T18:00:00.000Z",
      status: null,
    };
    const listItem = {
      id,
      peer: { id: senderId, username: "bob", online: true },
      lastMessage: message,
      unreadCount: 1,
      blocked: false,
    };
    expect(dialogListItemSchema.parse(listItem)).toEqual(listItem);
    expect(dialogListItemSchema.safeParse({ ...listItem, peer: { id: senderId, username: "bob" } }).success).toBe(
      false,
    );
    expect(
      openDialogSchema.parse({
        id,
        peer: { id: senderId, username: "bob" },
        created: true,
        blocked: false,
      }),
    ).toEqual({
      id,
      peer: { id: senderId, username: "bob" },
      created: true,
      blocked: false,
    });
  });
});
