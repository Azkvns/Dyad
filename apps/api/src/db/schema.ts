import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    check("users_username_format", sql`${table.username} ~ '^[a-z0-9_]{3,24}$'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);

export const dialogs = pgTable(
  "dialogs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userLow: uuid("user_low").notNull().references(() => users.id, { onDelete: "restrict" }),
    userHigh: uuid("user_high").notNull().references(() => users.id, { onDelete: "restrict" }),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dialogs_pair_unique").on(table.userLow, table.userHigh),
    check("dialogs_user_order", sql`${table.userLow} < ${table.userHigh}`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dialogId: uuid("dialog_id").notNull().references(() => dialogs.id, { onDelete: "restrict" }),
    senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    body: text("body").notNull(),
    clientMsgId: uuid("client_msg_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_dialog_seq_unique").on(table.dialogId, table.seq),
    uniqueIndex("messages_client_msg_unique").on(table.dialogId, table.senderId, table.clientMsgId),
    index("messages_dialog_seq_idx").on(table.dialogId, table.seq.desc()),
    check("messages_body_length", sql`char_length(${table.body}) between 1 and 2000`),
  ],
);

export const dialogCursors = pgTable(
  "dialog_cursors",
  {
    dialogId: uuid("dialog_id").notNull().references(() => dialogs.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    lastDeliveredSeq: bigint("last_delivered_seq", { mode: "number" }).notNull().default(0),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.dialogId, table.userId] }),
    check(
      "dialog_cursors_read_lte_delivered",
      sql`${table.lastReadSeq} <= ${table.lastDeliveredSeq}`,
    ),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    check("blocks_not_self", sql`${table.blockerId} <> ${table.blockedId}`),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reports_reporter_message_unique").on(table.reporterId, table.messageId),
    index("reports_reporter_created_idx").on(table.reporterId, table.createdAt.desc()),
    check("reports_reason", sql`${table.reason} in ('spam', 'abuse', 'other')`),
  ],
);
