import type { DialogListItem, OpenDialog } from "contracts";
import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { isUniqueViolation } from "../db/pg-error";
import { blocks, dialogCursors, dialogs, messages, users } from "../db/schema";
import { HttpError } from "../http-error";
import { BlockService } from "./block-service";
import { hub } from "./hub";
import { messageStatus } from "./message-status";
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

  async list(actorId: string): Promise<DialogListItem[]> {
    const rows = await this.db
      .select()
      .from(dialogs)
      .where(or(eq(dialogs.userLow, actorId), eq(dialogs.userHigh, actorId)));
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const peerIds = rows.map((row) => (row.userLow === actorId ? row.userHigh : row.userLow));
    const [peerRows, latestRows, cursorRows, blockRows, unreadRows] = await Promise.all([
      this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, peerIds)),
      this.db
        .selectDistinctOn([messages.dialogId], {
          id: messages.id,
          dialogId: messages.dialogId,
          seq: messages.seq,
          senderId: messages.senderId,
          body: messages.body,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.dialogId, ids))
        .orderBy(messages.dialogId, desc(messages.seq)),
      this.db.select().from(dialogCursors).where(inArray(dialogCursors.dialogId, ids)),
      this.db
        .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
        .from(blocks)
        .where(or(eq(blocks.blockerId, actorId), eq(blocks.blockedId, actorId))),
      this.db
        .select({
          dialogId: messages.dialogId,
          unread: sql<number>`count(*)::int`,
        })
        .from(messages)
        .innerJoin(
          dialogCursors,
          and(eq(dialogCursors.dialogId, messages.dialogId), eq(dialogCursors.userId, actorId)),
        )
        .where(
          and(
            inArray(messages.dialogId, ids),
            ne(messages.senderId, actorId),
            gt(messages.seq, dialogCursors.lastReadSeq),
          ),
        )
        .groupBy(messages.dialogId),
    ]);

    const peers = new Map(peerRows.map((peer) => [peer.id, peer]));
    const latest = new Map(latestRows.map((row) => [row.dialogId, row]));
    const unread = new Map(unreadRows.map((row) => [row.dialogId, Number(row.unread)]));
    const built = rows.map((row) => {
      const peerId = row.userLow === actorId ? row.userHigh : row.userLow;
      const peer = peers.get(peerId);
      if (!peer) throw new Error("peer missing");
      const message = latest.get(row.id) ?? null;
      const peerCursor = cursorRows.find((cursor) => cursor.dialogId === row.id && cursor.userId === peerId) ?? null;
      const blocked = blockRows.some(
        (block) =>
          (block.blockerId === actorId && block.blockedId === peerId) ||
          (block.blockerId === peerId && block.blockedId === actorId),
      );
      return {
        createdAt: row.createdAt,
        item: {
          id: row.id,
          peer: {
            id: peer.id,
            username: peer.username,
            online: blocked ? false : hub.socketCount(peerId) > 0,
          },
          lastMessage: message
            ? {
                id: message.id,
                seq: message.seq,
                senderId: message.senderId,
                body: message.body,
                createdAt: message.createdAt.toISOString(),
                status: messageStatus(message.senderId === actorId, message.seq, peerCursor),
              }
            : null,
          unreadCount: unread.get(row.id) ?? 0,
          blocked,
        } satisfies DialogListItem,
      };
    });

    built.sort((left, right) => {
      const leftMessage = left.item.lastMessage;
      const rightMessage = right.item.lastMessage;
      if (leftMessage && rightMessage) return rightMessage.createdAt.localeCompare(leftMessage.createdAt);
      if (leftMessage) return -1;
      if (rightMessage) return 1;
      return right.createdAt.getTime() - left.createdAt.getTime();
    });
    return built.map((row) => row.item);
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
