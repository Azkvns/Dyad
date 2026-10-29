import { afterEach, describe, expect, it } from "vitest";
import type { CursorState, MessageView } from "contracts";
import { hub } from "../src/services/hub";

const message: MessageView = {
  id: "00000000-0000-4000-8000-000000000001",
  seq: 1,
  senderId: "00000000-0000-4000-8000-000000000002",
  body: "hi",
  createdAt: "2026-10-29T18:00:00.000Z",
  status: "sent",
};

const cursor: CursorState = {
  dialogId: "00000000-0000-4000-8000-000000000003",
  userId: "00000000-0000-4000-8000-000000000002",
  lastDeliveredSeq: 1,
  lastReadSeq: 0,
};

describe("hub stub", () => {
  const originalSocketCount = hub.socketCount;

  afterEach(() => {
    hub.socketCount = originalSocketCount;
  });

  it("accepts attach, detach, send, and broadcast without throwing", () => {
    expect(() => hub.attach("user", {})).not.toThrow();
    expect(() => hub.detach("user", {})).not.toThrow();
    expect(() => hub.send("user", { type: "message.ack", dialogId: cursor.dialogId, message })).not.toThrow();
    expect(() => hub.broadcastCursor(cursor.dialogId, cursor)).not.toThrow();
  });

  it("reports zero sockets and allows the counter to be replaced", () => {
    expect(hub.socketCount("any")).toBe(0);
    const previous = hub.socketCount;
    hub.socketCount = () => 1;
    try {
      expect(hub.socketCount("any")).toBe(1);
    } finally {
      hub.socketCount = previous;
    }
  });
});
