import type { DialogListItem, MessageView } from "contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Outgoing } from "../live";
import { ThreadPane } from "./thread-pane";

const me = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const dialog: DialogListItem = {
  id: "33333333-3333-4333-8333-333333333333",
  peer: { id: bob, username: "bob", online: true },
  lastMessage: null,
  unreadCount: 0,
  blocked: false,
};
const theirs: MessageView = {
  id: "66666666-6666-4666-8666-666666666666",
  seq: 2,
  senderId: bob,
  body: "ответ",
  createdAt: "2026-11-05T09:31:00.000Z",
  status: null,
};

function renderPane(overrides: Partial<Parameters<typeof ThreadPane>[0]> = {}) {
  const onSend = vi.fn();
  const onRetry = vi.fn();
  const onPickReason = vi.fn();
  render(
    <MemoryRouter>
      <ThreadPane
        dialog={dialog}
        missing={false}
        meId={me}
        iBlocked={false}
        confirmed={[theirs]}
        outgoing={[]}
        nextBeforeSeq={null}
        draft=""
        reportMessageId={null}
        reportNote={null}
        onDraft={() => undefined}
        onSend={onSend}
        onRetry={onRetry}
        onOlder={() => undefined}
        onToggleBlock={() => undefined}
        onReport={() => undefined}
        onPickReason={onPickReason}
        onCloseReport={() => undefined}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onSend, onRetry, onPickReason };
}

describe("ThreadPane", () => {
  it("sends on Enter and keeps Shift+Enter in the field", () => {
    const { onSend } = renderPane({ draft: "привет" });
    const field = screen.getByLabelText("Сообщение");
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("keeps a failed bubble retryable and reports only the peer message", () => {
    const outgoing: Outgoing[] = [{ clientMsgId: "44444444-4444-4444-8444-444444444444", body: "привет", state: "failed", maxSeqAtSend: 0 }];
    const { onRetry, onPickReason } = renderPane({ outgoing, reportMessageId: theirs.id });
    expect(screen.getByText("не отправлено")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledWith(outgoing[0]?.clientMsgId);
    fireEvent.click(screen.getByRole("button", { name: "спам" }));
    expect(onPickReason).toHaveBeenCalledWith("spam");
    expect(screen.getAllByRole("button", { name: "Пожаловаться" })).toHaveLength(1);
  });

  it("hides the composer and the online words when the dialog is blocked", () => {
    renderPane({ dialog: { ...dialog, blocked: true, peer: { ...dialog.peer, online: true } }, iBlocked: true });
    expect(screen.getByText("Сообщения недоступны")).toBeTruthy();
    expect(screen.queryByLabelText("Сообщение")).toBeNull();
    expect(screen.queryByText("в сети")).toBeNull();
    expect(screen.getByRole("button", { name: "Разблокировать" })).toBeTruthy();
  });

  it("says the dialog was not found", () => {
    renderPane({ dialog: null, missing: true });
    expect(screen.getByText("Диалог не найден")).toBeTruthy();
  });
});
