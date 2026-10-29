import type { CursorState } from "contracts";
import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { dialogCursors } from "../db/schema";
import { HttpError } from "../http-error";
import { DialogService } from "./dialog-service";
import { hub } from "./hub";

export class CursorService {
  constructor(private readonly db: AppDatabase) {}

  delivered(actorId: string, dialogId: string, seq: number): Promise<CursorState> {
    return this.advance(actorId, dialogId, seq, false);
  }

  read(actorId: string, dialogId: string, seq: number): Promise<CursorState> {
    return this.advance(actorId, dialogId, seq, true);
  }

  private async advance(actorId: string, dialogId: string, seq: number, markRead: boolean): Promise<CursorState> {
    const dialog = await new DialogService(this.db).requireParticipant(actorId, dialogId);
    if (seq > dialog.lastSeq) {
      throw new HttpError(400, { error: "validation_error", fields: { seq: "invalid" } });
    }

    const before = await this.load(dialogId, actorId);
    const where = and(eq(dialogCursors.dialogId, dialogId), eq(dialogCursors.userId, actorId));
    if (markRead) {
      await this.db
        .update(dialogCursors)
        .set({
          lastDeliveredSeq: sql`greatest(${dialogCursors.lastDeliveredSeq}, ${seq})`,
          lastReadSeq: sql`greatest(${dialogCursors.lastReadSeq}, ${seq})`,
        })
        .where(where);
    } else {
      await this.db
        .update(dialogCursors)
        .set({
          lastDeliveredSeq: sql`greatest(${dialogCursors.lastDeliveredSeq}, ${seq})`,
        })
        .where(where);
    }

    const after = await this.load(dialogId, actorId);
    const state: CursorState = {
      dialogId,
      userId: actorId,
      lastDeliveredSeq: Number(after.lastDeliveredSeq),
      lastReadSeq: Number(after.lastReadSeq),
    };
    if (
      Number(after.lastDeliveredSeq) !== Number(before.lastDeliveredSeq) ||
      Number(after.lastReadSeq) !== Number(before.lastReadSeq)
    ) {
      hub.broadcastCursor(dialogId, state);
    }
    return state;
  }

  private async load(dialogId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(dialogCursors)
      .where(and(eq(dialogCursors.dialogId, dialogId), eq(dialogCursors.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("cursor missing");
    return row;
  }
}
