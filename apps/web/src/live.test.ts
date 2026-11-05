import type { DialogListItem, MessageView } from "contracts";
import { describe, expect, it } from "vitest";
import { initialLive, reduceLive, type LiveState } from "./live";

const me = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const dialogId = "33333333-3333-4333-8333-333333333333";
const clientMsgId = "44444444-4444-4444-8444-444444444444";

function dialog(overrides: Partial<DialogListItem> = {}): DialogListItem {
  return {
    id: dialogId,
    peer: { id: bob, username: "bob", online: false },
    lastMessage: null,
    unreadCount: 0,
    blocked: false,
    ...overrides,
  };
}

function message(overrides: Partial<MessageView> = {}): MessageView {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    seq: 1,
    senderId: me,
    body: "привет",
    createdAt: "2026-11-05T09:30:00.000Z",
    status: "sent",
    ...overrides,
  };
}

function openState(): LiveState {
  const started = reduceLive(initialLive(me), { type: "dialogs", dialogs: [dialog()] });
  return reduceLive(started.state, { type: "open", dialogId }).state;
}

describe("reduceLive", () => {
  it("shows a pending bubble and retries the same client id", () => {
    const composed = reduceLive(openState(), { type: "compose", clientMsgId, body: "привет" });
    expect(composed.state.outgoing).toEqual([
      { clientMsgId, body: "привет", state: "pending", maxSeqAtSend: 0 },
    ]);
    expect(composed.effects).toEqual([
      { type: "message.send", dialogId, body: "привет", clientMsgId },
    ]);
    const failed = reduceLive(composed.state, { type: "frame", frame: { type: "error", code: "forbidden", clientMsgId } });
    expect(failed.state.outgoing[0]?.state).toBe("failed");
    const retried = reduceLive(failed.state, { type: "retry", clientMsgId });
    expect(retried.effects).toEqual([
      { type: "message.send", dialogId, body: "привет", clientMsgId },
    ]);
  });

  it("acks the earliest matching bubble and applies the peer cursor", () => {
    const composed = reduceLive(openState(), { type: "compose", clientMsgId, body: "привет" });
    const acked = reduceLive(composed.state, { type: "frame", frame: { type: "message.ack", dialogId, message: message() } });
    expect(acked.state.outgoing).toEqual([]);
    expect(acked.state.confirmed[0]?.status).toBe("sent");
    const read = reduceLive(acked.state, {
      type: "frame",
      frame: { type: "cursor.updated", dialogId, userId: bob, lastDeliveredSeq: 1, lastReadSeq: 1 },
    });
    expect(read.state.confirmed[0]?.status).toBe("read");
    const mine = reduceLive(read.state, {
      type: "frame",
      frame: { type: "cursor.updated", dialogId, userId: me, lastDeliveredSeq: 0, lastReadSeq: 0 },
    });
    expect(mine.state.confirmed[0]?.status).toBe("read");
  });

  it("delivers an incoming message and reads it only while the dialog is open", () => {
    const incoming = message({ id: "66666666-6666-4666-8666-666666666666", senderId: bob, status: null });
    const closed = reduceLive(initialLive(me), { type: "dialogs", dialogs: [dialog()] }).state;
    const listed = reduceLive(closed, { type: "frame", frame: { type: "message.new", dialogId, message: incoming } });
    expect(listed.effects).toEqual([{ type: "cursor.delivered", dialogId, seq: 1 }]);
    expect(listed.state.dialogs[0]?.unreadCount).toBe(1);
    const opened = reduceLive(openState(), { type: "frame", frame: { type: "message.new", dialogId, message: incoming } });
    expect(opened.effects).toEqual([
      { type: "cursor.delivered", dialogId, seq: 1 },
      { type: "cursor.read", dialogId, seq: 1 },
    ]);
    expect(opened.state.confirmed[0]?.status).toBeNull();
  });

  it("reloads a missing dialog, ignores presence while blocked, and does not move an older page", () => {
    const missing = reduceLive(initialLive(me), {
      type: "frame",
      frame: { type: "message.new", dialogId, message: message({ senderId: bob, status: null }) },
    });
    expect(missing.effects).toContainEqual({ type: "reload-dialogs" });
    const online = reduceLive(openState(), { type: "frame", frame: { type: "presence", userId: bob, online: true } });
    expect(online.state.dialogs[0]?.peer.online).toBe(true);
    const blocked = reduceLive(online.state, {
      type: "dialogs",
      dialogs: [dialog({ blocked: true, peer: { id: bob, username: "bob", online: true } })],
    }).state;
    const hidden = reduceLive(blocked, { type: "frame", frame: { type: "presence", userId: bob, online: false } });
    expect(hidden.state.dialogs[0]?.blocked).toBe(true);
    expect(hidden.state.dialogs[0]?.peer.online).toBe(true);
    const older = reduceLive(openState(), {
      type: "older",
      dialogId,
      page: { messages: [message()], nextBeforeSeq: null },
    });
    expect(older.effects).toEqual([]);
  });

  it("drops a pending bubble once history contains it and keeps a failed one", () => {
    const composed = reduceLive(openState(), { type: "compose", clientMsgId, body: "привет" });
    const failed = reduceLive(composed.state, { type: "frame", frame: { type: "error", code: "internal", clientMsgId } });
    const kept = reduceLive(failed.state, { type: "history", dialogId, page: { messages: [message()], nextBeforeSeq: null } });
    expect(kept.state.outgoing.map((item) => item.state)).toEqual(["failed"]);
    const pending = reduceLive(composed.state, { type: "history", dialogId, page: { messages: [message()], nextBeforeSeq: null } });
    expect(pending.state.outgoing).toEqual([]);
    expect(pending.effects).toEqual([{ type: "cursor.read", dialogId, seq: 1 }]);
  });

  it("reloads the open history after ready and skips an empty read", () => {
    const ready = reduceLive(openState(), { type: "ready" });
    expect(ready.effects).toEqual([{ type: "reload-dialogs" }, { type: "reload-history" }]);
    const empty = reduceLive(openState(), { type: "history", dialogId, page: { messages: [], nextBeforeSeq: null } });
    expect(empty.effects).toEqual([]);
  });
});
