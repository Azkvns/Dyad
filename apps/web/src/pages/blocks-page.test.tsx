import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BlocksPage } from "./blocks-page";
import { ReportsPage } from "./reports-page";

describe("moderation pages", () => {
  it("unblocks one username and lists one report", () => {
    const onUnblock = vi.fn();
    render(
      <MemoryRouter>
        <BlocksPage usernames={["bob"]} onUnblock={onUnblock} />
        <ReportsPage
          reports={[
            {
              id: "77777777-7777-4777-8777-777777777777",
              messageId: "66666666-6666-4666-8666-666666666666",
              dialogId: "33333333-3333-4333-8333-333333333333",
              peerUsername: "ada",
              body: "привет",
              reason: "spam",
              createdAt: "2026-11-05T09:40:00.000Z",
            },
          ]}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Разблокировать" }));
    expect(onUnblock).toHaveBeenCalledWith("bob");
    expect(screen.getByText("привет")).toBeTruthy();
    expect(screen.getByText("спам")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "К диалогам" })).toHaveLength(2);
  });
});
