import type { DialogListItem } from "contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DialogList } from "./dialog-list";
import { Workspace } from "./workspace";

const dialog: DialogListItem = {
  id: "33333333-3333-4333-8333-333333333333",
  peer: { id: "22222222-2222-4222-8222-222222222222", username: "bob", online: true },
  lastMessage: {
    id: "55555555-5555-4555-8555-555555555555",
    seq: 1,
    senderId: "11111111-1111-4111-8111-111111111111",
    body: "привет",
    createdAt: "2026-11-05T09:30:00.000Z",
    status: "read",
  },
  unreadCount: 100,
  blocked: false,
};

describe("DialogList", () => {
  it("opens a peer, shows 99+, and marks the selected row", () => {
    const onOpenPeer = vi.fn();
    render(
      <MemoryRouter>
        <Workspace
          showThread
          list={
            <DialogList
              dialogs={[dialog]}
              selectedId={dialog.id}
              peerUsername="bob"
              peerError={null}
              onPeerUsername={() => undefined}
              onOpenPeer={onOpenPeer}
              onLogout={() => undefined}
            />
          }
          thread={<p>лента</p>}
        />
      </MemoryRouter>,
    );
    expect(document.querySelector(".workspace")?.getAttribute("data-thread")).toBe("open");
    expect(screen.getByLabelText("прочитано").textContent).toBe("✓✓");
    expect(screen.getByText("99+")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Новый диалог" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(onOpenPeer).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /bob/ }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the empty sentence", () => {
    render(
      <MemoryRouter>
        <DialogList dialogs={[]} selectedId={null} peerUsername="" peerError={null} onPeerUsername={() => undefined} onOpenPeer={() => undefined} onLogout={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Диалогов пока нет")).toBeTruthy();
  });
});
