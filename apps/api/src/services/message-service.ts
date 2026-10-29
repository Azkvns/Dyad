import type { MessageView } from "contracts";
import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { isUniqueViolation } from "../db/pg-error";
import { dialogCursors, dialogs, messages } from "../db/schema";
import { HttpError } from "../http-error";
import { BlockService } from "./block-service";
import { DialogService } from "./dialog-service";
import { hub } from "./hub";
import { messageStatus } from "./message-status";

type StoredMessage = typeof messages.$inferSelect;

export async function withSeqRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error, "messages_dialog_seq_unique")) throw error;
  }
  return run();
}

export class MessageService {
  constructor(private readonly db: AppDatabase) {}

  async send(
    actorId: string,
    dialogId: string,
    body: string,
    clientMsgId: string,
  ): Promise<{ message: MessageView; created: boolean }> {
    const dialog = await new DialogService(this.db).requireParticipant(actorId, dialogId);
    if (await new BlockService(this.db).isBlocked(actorId, dialog.peerId)) {
      throw new HttpError(403, { error: "forbidden" });
    }

    const existing = await this.findOwn(dialogId, actorId, clientMsgId);
    if (existing) {
      if (existing.body !== body) throw new HttpError(409, { error: "conflict" });
      return { message: await this.present(existing, actorId, dialog.peerId), created: false };
    }

    const outcome = await withSeqRetry(() => this.insertOrReplay(dialogId, actorId, body, clientMsgId));
    const message = await this.present(outcome.row, actorId, dialog.peerId);
    if (outcome.created) {
      hub.send(actorId, { type: "message.ack", dialogId, message });
      hub.send(dialog.peerId, {
        type: "message.new",
        dialogId,
        message: { ...message, status: null },
      });
    }
    return { message, created: outcome.created };
  }

  private async insertOrReplay(dialogId: string, actorId: string, body: string, clientMsgId: string) {
    try {
      const row = await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(dialogs)
          .set({ lastSeq: sql`${dialogs.lastSeq} + 1` })
          .where(eq(dialogs.id, dialogId))
          .returning({ lastSeq: dialogs.lastSeq });
        const seq = updated[0]?.lastSeq;
        if (seq === undefined) throw new Error("dialog update returned no row");
        const inserted = await tx
          .insert(messages)
          .values({ dialogId, senderId: actorId, seq, body, clientMsgId })
          .returning();
        const created = inserted[0];
        if (!created) throw new Error("message insert returned no row");
        return created;
      });
      return { row, created: true as const };
    } catch (error) {
      if (!isUniqueViolation(error, "messages_client_msg_unique")) throw error;
      const row = await this.findOwn(dialogId, actorId, clientMsgId);
      if (!row) throw error;
      if (row.body !== body) throw new HttpError(409, { error: "conflict" });
      return { row, created: false as const };
    }
  }

  private async findOwn(dialogId: string, senderId: string, clientMsgId: string) {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.dialogId, dialogId),
          eq(messages.senderId, senderId),
          eq(messages.clientMsgId, clientMsgId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async present(row: StoredMessage, actorId: string, peerId: string): Promise<MessageView> {
    const cursors = await this.db
      .select({
        lastDeliveredSeq: dialogCursors.lastDeliveredSeq,
        lastReadSeq: dialogCursors.lastReadSeq,
      })
      .from(dialogCursors)
      .where(and(eq(dialogCursors.dialogId, row.dialogId), eq(dialogCursors.userId, peerId)))
      .limit(1);
    return {
      id: row.id,
      seq: row.seq,
      senderId: row.senderId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      status: messageStatus(row.senderId === actorId, row.seq, cursors[0] ?? null),
    };
  }
}
