import type { CursorState, MessageView } from "contracts";

export type OutboundFrame =
  | { type: "message.ack"; dialogId: string; message: MessageView }
  | { type: "message.new"; dialogId: string; message: MessageView }
  | { type: "cursor.updated"; dialogId: string; userId: string; lastDeliveredSeq: number; lastReadSeq: number };

export const hub = {
  attach(_userId: string, _socket: unknown): void {},
  detach(_userId: string, _socket: unknown): void {},
  send(_userId: string, _frame: OutboundFrame): void {},
  broadcastCursor(_dialogId: string, _state: CursorState): void {},
  socketCount(_userId: string): number {
    return 0;
  },
};
