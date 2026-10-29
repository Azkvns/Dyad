import { describe, expect, it } from "vitest";
import {
  loginBodySchema,
  publicUserSchema,
  registerBodySchema,
  storedUsernameSchema,
  usernameSchema,
  zodIssuesToFields,
} from "./index";

function fields(schema: { safeParse: (input: unknown) => { success: boolean; error?: { issues: readonly import("zod").core.$ZodIssue[] } } }, input: unknown) {
  const parsed = schema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success || !parsed.error) throw new Error("expected failure");
  return zodIssuesToFields(parsed.error.issues);
}

describe("usernameSchema", () => {
  it("lowercases a valid login", () => {
    expect(usernameSchema.parse("Alice")).toBe("alice");
    expect(usernameSchema.parse("ok_1")).toBe("ok_1");
  });

  it("rejects a short login", () => {
    expect(fields(registerBodySchema, { username: "ab", password: "password1" })).toEqual({
      username: "too_short",
    });
  });

  it("rejects a login longer than 24 characters", () => {
    expect(fields(registerBodySchema, { username: "a".repeat(25), password: "password1" })).toEqual({
      username: "too_long",
    });
  });

  it("rejects characters outside the alphabet", () => {
    expect(fields(registerBodySchema, { username: "bad-name", password: "password1" })).toEqual({
      username: "invalid",
    });
  });

  it("does not trim spaces", () => {
    expect(fields(registerBodySchema, { username: " alice", password: "password1" })).toEqual({
      username: "invalid",
    });
  });

  it("storedUsernameSchema rejects uppercase", () => {
    expect(storedUsernameSchema.safeParse("Alice").success).toBe(false);
    expect(storedUsernameSchema.parse("alice")).toBe("alice");
  });
});

describe("passwordSchema", () => {
  it("rejects fewer than 8 characters", () => {
    expect(fields(registerBodySchema, { username: "alice", password: "short" })).toEqual({
      password: "too_short",
    });
  });

  it("accepts 72 ascii bytes and rejects 73", () => {
    expect(registerBodySchema.parse({ username: "alice", password: "a".repeat(72) }).password).toHaveLength(72);
    expect(fields(registerBodySchema, { username: "alice", password: "a".repeat(73) })).toEqual({
      password: "too_long",
    });
  });

  it("counts utf-8 bytes", () => {
    expect(registerBodySchema.parse({ username: "alice", password: "я".repeat(36) }).password).toHaveLength(36);
    expect(fields(registerBodySchema, { username: "alice", password: "я".repeat(37) })).toEqual({
      password: "too_long",
    });
  });
});

describe("credential bodies", () => {
  it("marks a missing field required", () => {
    expect(fields(registerBodySchema, { username: "alice" })).toEqual({ password: "required" });
    expect(fields(loginBodySchema, { password: "password1" })).toEqual({ username: "required" });
  });

  it("parses a public user", () => {
    expect(
      publicUserSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        username: "alice",
      }),
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      username: "alice",
    });
  });
});
