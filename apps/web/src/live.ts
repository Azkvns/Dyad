import type { ClientFrame, DialogListItem, MessageStatus, MessageView, ServerFrame } from "contracts";

export type Outgoing = {
  clientMsgId: string;
  body: string;
  state: "pending" | "failed";
  maxSeqAtSend: number;
};

type PeerCursor = { userId: string; lastDeliveredSeq: number; lastReadSeq: number };

export type LiveState = {
  meId: string;
  dialogsLoaded: boolean;
  dialogs: DialogListItem[];
  blockedUsernames: string[];
  openDialogId: string | null;
  confirmed: MessageView[];
  outgoing: Outgoing[];
  nextBeforeSeq: number | null;
  peerCursors: Record<string, PeerCursor>;
  lastReadSent: number;
};

export type LiveEffect = ClientFrame | { type: "reload-dialogs" } | { type: "reload-history" };

export type LiveEvent =
  | { type: "dialogs"; dialogs: DialogListItem[] }
  | { type: "blocks"; usernames: string[] }
  | { type: "ensure-dialog"; dialog: DialogListItem }
  | { type: "open"; dialogId: string }
  | { type: "history"; dialogId: string; page: { messages: MessageView[]; nextBeforeSeq: number | null } }
  | { type: "older"; dialogId: string; page: { messages: MessageView[]; nextBeforeSeq: number | null } }
  | { type: "compose"; clientMsgId: string; body: string }
  | { type: "retry"; clientMsgId: string }
  | { type: "ready" }
  | { type: "frame"; frame: ServerFrame };

export function initialLive(meId: string): LiveState {
  return {
    meId,
    dialogsLoaded: false,
    dialogs: [],
    blockedUsernames: [],
    openDialogId: null,
    confirmed: [],
    outgoing: [],
    nextBeforeSeq: null,
    peerCursors: {},
    lastReadSent: 0,
  };
}

function statusFromCursor(seq: number, cursor: PeerCursor | null): MessageStatus {
  if (!cursor) return "sent";
  if (seq <= cursor.lastReadSeq) return "read";
  if (seq <= cursor.lastDeliveredSeq) return "delivered";
  return "sent";
}

function maxSeq(messages: MessageView[]): number {
  return messages.reduce((max, message) => Math.max(max, message.seq), 0);
}

function withStatus(message: MessageView, cursor: PeerCursor | null, meId: string): MessageView {
  if (message.senderId !== meId) return { ...message, status: null };
  return { ...message, status: statusFromCursor(message.seq, cursor) };
}

function insertBySeq(messages: MessageView[], message: MessageView): MessageView[] {
  if (messages.some((item) => item.id === message.id)) return messages;
  const next = [...messages, message];
  next.sort((left, right) => left.seq - right.seq);
  return next;
}

function reconcile(confirmed: MessageView[], outgoing: Outgoing[], meId: string): Outgoing[] {
  const used = new Set<string>();
  const next: Outgoing[] = [];
  for (const bubble of outgoing) {
    if (bubble.state === "failed") {
      next.push(bubble);
      continue;
    }
    const match = confirmed.find(
      (message) =>
        message.senderId === meId &&
        message.body === bubble.body &&
        message.seq > bubble.maxSeqAtSend &&
        !used.has(message.id),
    );
    if (match) used.add(match.id);
    else next.push(bubble);
  }
  return next;
}

function readEffect(state: LiveState, dialogId: string, seq: number): { state: LiveState; effects: LiveEffect[] } {
  if (seq <= 0 || seq <= state.lastReadSent) return { state, effects: [] };
  return { state: { ...state, lastReadSent: seq }, effects: [{ type: "cursor.read", dialogId, seq }] };
}

function touch(
  dialogs: DialogListItem[],
  id: string,
  patch: Partial<DialogListItem>,
): { dialogs: DialogListItem[]; found: boolean } {
  const current = dialogs.find((dialog) => dialog.id === id);
  if (!current) return { dialogs, found: false };
  const next = { ...current, ...patch };
  return { dialogs: [next, ...dialogs.filter((dialog) => dialog.id !== id)], found: true };
}

function paintList(state: LiveState, cursor: PeerCursor, dialogId: string): DialogListItem[] {
  return state.dialogs.map((dialog) => {
    if (dialog.id !== dialogId || !dialog.lastMessage || dialog.lastMessage.senderId !== state.meId) return dialog;
    return {
      ...dialog,
      lastMessage: { ...dialog.lastMessage, status: statusFromCursor(dialog.lastMessage.seq, cursor) },
    };
  });
}

function applyFrame(state: LiveState, frame: ServerFrame): { state: LiveState; effects: LiveEffect[] } {
  if (frame.type === "ready" || frame.type === "pong") return { state, effects: [] };
  if (frame.type === "error") {
    if (!frame.clientMsgId) return { state, effects: [] };
    return {
      state: {
        ...state,
        outgoing: state.outgoing.map((item) =>
          item.clientMsgId === frame.clientMsgId ? { ...item, state: "failed" } : item,
        ),
      },
      effects: [],
    };
  }
  if (frame.type === "presence") {
    return {
      state: {
        ...state,
        dialogs: state.dialogs.map((dialog) => {
          if (dialog.peer.id !== frame.userId || dialog.blocked) return dialog;
          return { ...dialog, peer: { ...dialog.peer, online: frame.online } };
        }),
      },
      effects: [],
    };
  }
  if (frame.type === "cursor.updated") {
    if (frame.userId === state.meId) return { state, effects: [] };
    const cursor = { userId: frame.userId, lastDeliveredSeq: frame.lastDeliveredSeq, lastReadSeq: frame.lastReadSeq };
    const peerCursors = { ...state.peerCursors, [frame.dialogId]: cursor };
    const dialogs = paintList(state, cursor, frame.dialogId);
    if (frame.dialogId !== state.openDialogId) return { state: { ...state, peerCursors, dialogs }, effects: [] };
    return {
      state: {
        ...state,
        peerCursors,
        dialogs,
        confirmed: state.confirmed.map((message) => withStatus(message, cursor, state.meId)),
      },
      effects: [],
    };
  }
  if (frame.type !== "message.ack" && frame.type !== "message.new") return { state, effects: [] };
  const open = frame.dialogId === state.openDialogId;
  const cursor = state.peerCursors[frame.dialogId] ?? null;
  let confirmed = state.confirmed;
  let outgoing = state.outgoing;
  if (open) {
    const message = withStatus(frame.message, cursor, state.meId);
    const inserted = insertBySeq(state.confirmed, message);
    const added = inserted.length !== state.confirmed.length;
    confirmed = inserted;
    if (frame.type === "message.ack" && added) {
      const index = outgoing.findIndex((item) => item.state === "pending" && item.body === frame.message.body);
      if (index >= 0) outgoing = outgoing.filter((_, itemIndex) => itemIndex !== index);
    }
  }
  const current = state.dialogs.find((dialog) => dialog.id === frame.dialogId);
  const preview = frame.type === "message.new" ? { ...frame.message, status: null } : withStatus(frame.message, cursor, state.meId);
  const unreadCount =
    frame.type === "message.new" && !open ? (current?.unreadCount ?? 0) + 1 : frame.type === "message.new" ? 0 : (current?.unreadCount ?? 0);
  const touched = touch(state.dialogs, frame.dialogId, { lastMessage: preview, unreadCount });
  const effects: LiveEffect[] = [];
  if (!touched.found) effects.push({ type: "reload-dialogs" });
  let next: LiveState = { ...state, confirmed, outgoing, dialogs: touched.dialogs };
  if (frame.type === "message.new") {
    effects.push({ type: "cursor.delivered", dialogId: frame.dialogId, seq: frame.message.seq });
    if (open) {
      const read = readEffect(next, frame.dialogId, frame.message.seq);
      next = read.state;
      effects.push(...read.effects);
    }
  }
  return { state: next, effects };
}

export function reduceLive(state: LiveState, event: LiveEvent): { state: LiveState; effects: LiveEffect[] } {
  if (event.type === "dialogs") return { state: { ...state, dialogsLoaded: true, dialogs: event.dialogs }, effects: [] };
  if (event.type === "blocks") return { state: { ...state, blockedUsernames: event.usernames }, effects: [] };
  if (event.type === "ensure-dialog") {
    if (state.dialogs.some((dialog) => dialog.id === event.dialog.id)) return { state, effects: [] };
    return { state: { ...state, dialogs: [...state.dialogs, event.dialog] }, effects: [] };
  }
  if (event.type === "open") {
    if (state.openDialogId === event.dialogId) return { state, effects: [] };
    return {
      state: {
        ...state,
        openDialogId: event.dialogId,
        confirmed: [],
        outgoing: [],
        nextBeforeSeq: null,
        lastReadSent: 0,
        dialogs: state.dialogs.map((dialog) => (dialog.id === event.dialogId ? { ...dialog, unreadCount: 0 } : dialog)),
      },
      effects: [],
    };
  }
  if (event.type === "history") {
    if (event.dialogId !== state.openDialogId) return { state, effects: [] };
    const cursor = state.peerCursors[event.dialogId] ?? null;
    const confirmed = event.page.messages.map((message) => withStatus(message, cursor, state.meId));
    const next: LiveState = {
      ...state,
      confirmed,
      outgoing: reconcile(confirmed, state.outgoing, state.meId),
      nextBeforeSeq: event.page.nextBeforeSeq,
      dialogs: state.dialogs.map((dialog) => (dialog.id === event.dialogId ? { ...dialog, unreadCount: 0 } : dialog)),
    };
    return readEffect(next, event.dialogId, maxSeq(confirmed));
  }
  if (event.type === "older") {
    if (event.dialogId !== state.openDialogId) return { state, effects: [] };
    const cursor = state.peerCursors[event.dialogId] ?? null;
    const older = event.page.messages.map((message) => withStatus(message, cursor, state.meId));
    const confirmed = [...older, ...state.confirmed.filter((message) => !older.some((item) => item.id === message.id))];
    confirmed.sort((left, right) => left.seq - right.seq);
    return { state: { ...state, confirmed, nextBeforeSeq: event.page.nextBeforeSeq }, effects: [] };
  }
  if (event.type === "compose") {
    if (!state.openDialogId) return { state, effects: [] };
    return {
      state: {
        ...state,
        outgoing: [
          ...state.outgoing,
          { clientMsgId: event.clientMsgId, body: event.body, state: "pending", maxSeqAtSend: maxSeq(state.confirmed) },
        ],
      },
      effects: [{ type: "message.send", dialogId: state.openDialogId, body: event.body, clientMsgId: event.clientMsgId }],
    };
  }
  if (event.type === "retry") {
    if (!state.openDialogId) return { state, effects: [] };
    const bubble = state.outgoing.find((item) => item.clientMsgId === event.clientMsgId);
    if (!bubble) return { state, effects: [] };
    return {
      state: {
        ...state,
        outgoing: state.outgoing.map((item) => (item.clientMsgId === event.clientMsgId ? { ...item, state: "pending" } : item)),
      },
      effects: [{ type: "message.send", dialogId: state.openDialogId, body: bubble.body, clientMsgId: bubble.clientMsgId }],
    };
  }
  if (event.type === "ready") {
    const effects: LiveEffect[] = [{ type: "reload-dialogs" }];
    if (state.openDialogId) effects.push({ type: "reload-history" });
    return { state, effects };
  }
  return applyFrame(state, event.frame);
}
