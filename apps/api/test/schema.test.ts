import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "../src/db/client";
import { blocks, dialogCursors, dialogs, messages, reports, sessions, users } from "../src/db/schema";
import { expectSqlstate, resetDatabase, testDatabaseUrl } from "./helpers";

const low = "00000000-0000-4000-8000-000000000001";
const high = "00000000-0000-4000-8000-000000000002";

describe("schema", () => {
  let db: AppDatabase;
  let close: () => Promise<void>;

  beforeAll(() => {
    const opened = createDatabase(testDatabaseUrl());
    db = opened.db;
    close = opened.close;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  it("creates the seven spec tables and history indexes", async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect([...tables].map((row) => row.table_name).sort()).toEqual([
      "blocks",
      "dialog_cursors",
      "dialogs",
      "messages",
      "reports",
      "sessions",
      "users",
    ]);

    const indexes = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = [...indexes].map((row) => row.indexname);
    expect(names).toContain("messages_dialog_seq_idx");
    expect(names).toContain("reports_reporter_created_idx");
  });

  it("checks and uniquifies usernames", async () => {
    await expectSqlstate(
      db.insert(users).values({ username: "Ab", passwordHash: "hash" }),
      "23514",
    );
    await db.insert(users).values({ username: "alice", passwordHash: "hash" });
    await expectSqlstate(
      db.insert(users).values({ username: "alice", passwordHash: "other" }),
      "23505",
    );
  });

  it("guards dialog order, message identity, body length, and cursors", async () => {
    await db.insert(users).values([
      { id: low, username: "low_user", passwordHash: "hash" },
      { id: high, username: "high_user", passwordHash: "hash" },
    ]);
    await expectSqlstate(
      db.insert(dialogs).values({ userLow: high, userHigh: low, lastSeq: 0 }),
      "23514",
    );
    await db.insert(dialogs).values({ userLow: low, userHigh: high, lastSeq: 0 });
    await expectSqlstate(
      db.insert(dialogs).values({ userLow: low, userHigh: high, lastSeq: 0 }),
      "23505",
    );
    const [dialog] = await db.select().from(dialogs);
    if (!dialog) throw new Error("dialog missing");
    await db.insert(messages).values({
      dialogId: dialog.id,
      senderId: low,
      seq: 1,
      body: "hi",
      clientMsgId: "00000000-0000-4000-8000-000000000010",
    });
    await expectSqlstate(
      db.insert(messages).values({
        dialogId: dialog.id,
        senderId: high,
        seq: 1,
        body: "other",
        clientMsgId: "00000000-0000-4000-8000-000000000011",
      }),
      "23505",
    );
    await expectSqlstate(
      db.insert(messages).values({
        dialogId: dialog.id,
        senderId: low,
        seq: 2,
        body: "",
        clientMsgId: "00000000-0000-4000-8000-000000000012",
      }),
      "23514",
    );
    await expectSqlstate(
      db.insert(messages).values({
        dialogId: dialog.id,
        senderId: low,
        seq: 2,
        body: "x".repeat(2001),
        clientMsgId: "00000000-0000-4000-8000-000000000013",
      }),
      "23514",
    );
    await db.insert(dialogCursors).values({
      dialogId: dialog.id,
      userId: low,
      lastDeliveredSeq: 1,
      lastReadSeq: 0,
    });
    await expectSqlstate(
      db.insert(dialogCursors).values({
        dialogId: dialog.id,
        userId: high,
        lastDeliveredSeq: 0,
        lastReadSeq: 1,
      }),
      "23514",
    );
  });

  it("checks blocks and reports and refuses user delete", async () => {
    await db.insert(users).values([
      { id: low, username: "low_user", passwordHash: "hash" },
      { id: high, username: "high_user", passwordHash: "hash" },
    ]);
    await expectSqlstate(db.insert(blocks).values({ blockerId: low, blockedId: low }), "23514");
    const [dialog] = await db.insert(dialogs).values({ userLow: low, userHigh: high, lastSeq: 1 }).returning();
    if (!dialog) throw new Error("dialog missing");
    const [message] = await db
      .insert(messages)
      .values({
        dialogId: dialog.id,
        senderId: low,
        seq: 1,
        body: "hi",
        clientMsgId: "00000000-0000-4000-8000-000000000010",
      })
      .returning();
    if (!message) throw new Error("message missing");
    await expectSqlstate(
      db.insert(reports).values({ reporterId: high, messageId: message.id, reason: "nope" }),
      "23514",
    );
    await db.insert(reports).values({ reporterId: high, messageId: message.id, reason: "spam" });
    await expectSqlstate(
      db.insert(reports).values({ reporterId: high, messageId: message.id, reason: "abuse" }),
      "23505",
    );
    await db.insert(sessions).values({
      userId: low,
      tokenHash: "abc",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expectSqlstate(db.delete(users).where(eq(users.id, low)), "23503");
  });
});
