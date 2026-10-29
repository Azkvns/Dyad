import type { ReportListItem, ReportReason } from "contracts";
import { reportReasonSchema } from "contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { isUniqueViolation } from "../db/pg-error";
import { dialogs, messages, reports, users } from "../db/schema";
import { HttpError } from "../http-error";

type DialogEnds = { userLow: string; userHigh: string };

function peerId(actorId: string, row: DialogEnds): string {
  return row.userLow === actorId ? row.userHigh : row.userLow;
}

export class ReportService {
  constructor(private readonly db: AppDatabase) {}

  async create(actorId: string, messageId: string, reason: ReportReason): Promise<ReportListItem> {
    const found = await this.db
      .select({
        id: messages.id,
        dialogId: messages.dialogId,
        senderId: messages.senderId,
        body: messages.body,
        userLow: dialogs.userLow,
        userHigh: dialogs.userHigh,
      })
      .from(messages)
      .innerJoin(dialogs, eq(dialogs.id, messages.dialogId))
      .where(eq(messages.id, messageId))
      .limit(1);
    const row = found[0];
    if (!row || (row.userLow !== actorId && row.userHigh !== actorId)) {
      throw new HttpError(404, { error: "not_found" });
    }
    if (row.senderId === actorId) throw new HttpError(403, { error: "forbidden" });

    const existing = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, actorId), eq(reports.messageId, messageId)))
      .limit(1);
    if (existing[0]) throw new HttpError(409, { error: "already_reported" });

    const peer = peerId(actorId, row);
    const names = await this.db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, peer))
      .limit(1);
    const peerUsername = names[0]?.username;
    if (!peerUsername) throw new Error("peer missing");

    try {
      const inserted = await this.db
        .insert(reports)
        .values({ reporterId: actorId, messageId, reason })
        .returning();
      const created = inserted[0];
      if (!created) throw new Error("report insert returned no row");
      return {
        id: created.id,
        messageId,
        dialogId: row.dialogId,
        peerUsername,
        body: row.body,
        reason,
        createdAt: created.createdAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error, "reports_reporter_message_unique")) {
        throw new HttpError(409, { error: "already_reported" });
      }
      throw error;
    }
  }

  async list(actorId: string): Promise<ReportListItem[]> {
    const rows = await this.db
      .select({
        id: reports.id,
        messageId: reports.messageId,
        reason: reports.reason,
        createdAt: reports.createdAt,
        dialogId: messages.dialogId,
        body: messages.body,
        userLow: dialogs.userLow,
        userHigh: dialogs.userHigh,
      })
      .from(reports)
      .innerJoin(messages, eq(messages.id, reports.messageId))
      .innerJoin(dialogs, eq(dialogs.id, messages.dialogId))
      .where(eq(reports.reporterId, actorId))
      .orderBy(desc(reports.createdAt));
    const ids = [...new Set(rows.map((row) => peerId(actorId, row)))];
    const names =
      ids.length === 0
        ? []
        : await this.db
            .select({ id: users.id, username: users.username })
            .from(users)
            .where(inArray(users.id, ids));
    const usernames = new Map(names.map((row) => [row.id, row.username]));
    return rows.map((row) => {
      const username = usernames.get(peerId(actorId, row));
      if (!username) throw new Error("peer missing");
      return {
        id: row.id,
        messageId: row.messageId,
        dialogId: row.dialogId,
        peerUsername: username,
        body: row.body,
        reason: reportReasonSchema.parse(row.reason),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
