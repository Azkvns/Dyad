import type { CursorState, ServerFrame } from "contracts";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/client";
import { dialogs } from "../db/schema";
import { BlockService } from "./block-service";

export type OutboundFrame = Extract<
  ServerFrame,
  { type: "message.ack" | "message.new" | "cursor.updated" | "presence" }
>;

export type HubSocket = {
  readyState?: number;
  send?: (data: string) => void;
};

type HubLog = { error: (obj: unknown, msg?: string) => void };

const sockets = new Map<string, Set<HubSocket>>();
let database: AppDatabase | null = null;
let logger: HubLog | null = null;
let pending: Promise<void> = Promise.resolve();

function sizeOf(userId: string): number {
  return sockets.get(userId)?.size ?? 0;
}

function schedule(work: () => Promise<void>): void {
  const promise = work().catch((error: unknown) => {
    logger?.error({ err: error }, "hub background task failed");
  });
  pending = pending.then(() => promise);
}

export function bindHub(db: AppDatabase, log: HubLog): void {
  database = db;
  logger = log;
}

export function flushHub(): Promise<void> {
  return pending;
}

export function clearHub(): void {
  sockets.clear();
}

async function notifyPresence(userId: string, online: boolean): Promise<void> {
  if (!database || !z.uuid().safeParse(userId).success) return;
  const rows = await database
    .select({ userLow: dialogs.userLow, userHigh: dialogs.userHigh })
    .from(dialogs)
    .where(or(eq(dialogs.userLow, userId), eq(dialogs.userHigh, userId)));
  if (online ? sizeOf(userId) === 0 : sizeOf(userId) > 0) return;
  const blocks = new BlockService(database);
  for (const row of rows) {
    if (online ? sizeOf(userId) === 0 : sizeOf(userId) > 0) return;
    const peerId = row.userLow === userId ? row.userHigh : row.userLow;
    if (await blocks.isBlocked(userId, peerId)) continue;
    hub.send(peerId, { type: "presence", userId, online });
  }
}

async function fanoutCursor(dialogId: string, state: CursorState): Promise<void> {
  if (!database) return;
  const rows = await database
    .select({ userLow: dialogs.userLow, userHigh: dialogs.userHigh })
    .from(dialogs)
    .where(eq(dialogs.id, dialogId))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const frame: OutboundFrame = {
    type: "cursor.updated",
    dialogId,
    userId: state.userId,
    lastDeliveredSeq: state.lastDeliveredSeq,
    lastReadSeq: state.lastReadSeq,
  };
  hub.send(row.userLow, frame);
  hub.send(row.userHigh, frame);
}

export const hub = {
  attach(userId: string, socket: HubSocket): void {
    const before = sizeOf(userId);
    let set = sockets.get(userId);
    if (!set) {
      set = new Set();
      sockets.set(userId, set);
    }
    const added = !set.has(socket);
    set.add(socket);
    if (added && before === 0 && set.size === 1) schedule(() => notifyPresence(userId, true));
  },
  detach(userId: string, socket: HubSocket): void {
    const set = sockets.get(userId);
    if (!set?.has(socket)) return;
    set.delete(socket);
    if (set.size === 0) {
      sockets.delete(userId);
      schedule(() => notifyPresence(userId, false));
    }
  },
  send(userId: string, frame: OutboundFrame): void {
    const set = sockets.get(userId);
    if (!set) return;
    const payload = JSON.stringify(frame);
    for (const socket of [...set]) {
      if (socket.readyState !== 1 || typeof socket.send !== "function") continue;
      try {
        socket.send(payload);
      } catch (error) {
        hub.detach(userId, socket);
        logger?.error({ err: error }, "socket send failed");
      }
    }
  },
  broadcastCursor(dialogId: string, state: CursorState): void {
    schedule(() => fanoutCursor(dialogId, state));
  },
  socketCount(userId: string): number {
    return sizeOf(userId);
  },
};
