import type { ClientFrame, DialogListItem, ServerFrame } from "contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { Mailbox } from "./mailbox";
import type { connectSocket } from "./socket";

const me = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const dialogId = "33333333-3333-4333-8333-333333333333";

const dialog: DialogListItem = {
  id: dialogId,
  peer: { id: bob, username: "bob", online: false },
  lastMessage: null,
  unreadCount: 0,
  blocked: false,
};

describe("Mailbox", () => {
  it("opens a peer and delivers an incoming message", async () => {
    let opened = false;
    const openDialog = vi.fn(async () => {
      opened = true;
      return { id: dialogId, peer: { id: bob, username: "bob" }, created: true, blocked: false };
    });
    const api = {
      me: vi.fn(async () => ({ id: me, username: "ada" })),
      listDialogs: vi.fn(async () => (opened ? [dialog] : [])),
      listBlocks: vi.fn(async () => []),
      history: vi.fn(async () => ({ messages: [], nextBeforeSeq: null })),
      openDialog,
      listReports: vi.fn(async () => []),
    } as unknown as Api;
    const sent: ClientFrame[] = [];
    let onFrame: (frame: ServerFrame) => void = () => undefined;
    const connect = vi.fn((options: Parameters<typeof connectSocket>[0]) => {
      onFrame = options.onFrame;
      options.onReady();
      return { send: (frame: ClientFrame) => sent.push(frame), close: () => undefined };
    });

    render(
      <MemoryRouter initialEntries={["/dialogs"]}>
        <Routes>
          <Route path="/*" element={<Mailbox api={api} connect={connect} />} />
        </Routes>
      </MemoryRouter>,
    );

    const field = await screen.findByLabelText("логин собеседника");
    fireEvent.change(field, { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(openDialog).toHaveBeenCalledWith("bob");
    await screen.findByRole("link", { name: /bob/ });
    onFrame({
      type: "message.new",
      dialogId,
      message: {
        id: "66666666-6666-4666-8666-666666666666",
        seq: 1,
        senderId: bob,
        body: "ответ",
        createdAt: "2026-11-05T09:31:00.000Z",
        status: null,
      },
    });
    expect(sent).toContainEqual({ type: "cursor.delivered", dialogId, seq: 1 });
  });
});
