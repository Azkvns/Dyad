import type { OpenDialog } from "contracts";
import { and, eq } from "drizzle-orm";
import { isUniqueViolation } from "../db/pg-error";
import type { AppDatabase } from "../db/client";
import { dialogCursors, dialogs } from "../db/schema";
import { HttpError } from "../http-error";
import { BlockService } from "./block-service";
import { UserService } from "./user-service";

export type ParticipantDialog = {
  id: string;
  userLow: string;
  userHigh: string;
  lastSeq: number;
  peerId: string;
};

function orderedPair(a: string, b: string): { userLow: string; userHigh: string } {
  return a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
}

export class DialogService {
  constructor(private readonly db: AppDatabase) {}

  async open(actorId: string, username: string): Promise<{ dialog: OpenDialog; created: boolean }> {
    const peer = await new UserService(this.db).lookup(actorId, username);
    const blocked = await new BlockService(this.db).isBlocked(actorId, peer.id);
    const pair = orderedPair(actorId, peer.id);
    let row = await this.findPair(pair.userLow, pair.userHigh);
    if (!row && blocked) throw new HttpError(403, { error: "forbidden" });

    let created = false;
    if (!row) {
      try {
        row = await this.insertPair(pair.userLow, pair.userHigh);
        created = true;
      } catch (error) {
        if (!isUniqueViolation(error, "dialogs_pair_unique")) throw error;
        row = await this.findPair(pair.userLow, pair.userHigh);
        if (!row) throw error;
      }
    }

    return {
      created,
      dialog: {
        id: row.id,
        peer: { id: peer.id, username: peer.username },
        created,
        blocked,
      },
    };
  }

  async requireParticipant(actorId: string, dialogId: string): Promise<ParticipantDialog> {
    const rows = await this.db.select().from(dialogs).where(eq(dialogs.id, dialogId)).limit(1);
    const row = rows[0];
    if (!row || (row.userLow !== actorId && row.userHigh !== actorId)) {
      throw new HttpError(404, { error: "not_found" });
    }
    return {
      id: row.id,
      userLow: row.userLow,
      userHigh: row.userHigh,
      lastSeq: row.lastSeq,
      peerId: row.userLow === actorId ? row.userHigh : row.userLow,
    };
  }

  async participantIds(dialogId: string): Promise<{ userLow: string; userHigh: string } | null> {
    const rows = await this.db
      .select({ userLow: dialogs.userLow, userHigh: dialogs.userHigh })
      .from(dialogs)
      .where(eq(dialogs.id, dialogId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findPair(userLow: string, userHigh: string) {
    const rows = await this.db
      .select({ id: dialogs.id })
      .from(dialogs)
      .where(and(eq(dialogs.userLow, userLow), eq(dialogs.userHigh, userHigh)))
      .limit(1);
    return rows[0];
  }

  private async insertPair(userLow: string, userHigh: string) {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(dialogs)
        .values({ userLow, userHigh })
        .returning({ id: dialogs.id });
      const row = inserted[0];
      if (!row) throw new Error("dialog insert returned no row");
      await tx.insert(dialogCursors).values([
        { dialogId: row.id, userId: userLow },
        { dialogId: row.id, userId: userHigh },
      ]);
      return row;
    });
  }
}
