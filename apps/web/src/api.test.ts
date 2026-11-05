import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api";

const me = { id: "11111111-1111-4111-8111-111111111111", username: "ada" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createApi", () => {
  it("sends the session cookie and skips unauthorized redirect on login", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "invalid_credentials" }));
    const api = createApi(fetchImpl, onUnauthorized);
    await expect(api.login("Ada", "password1")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "Ada", password: "password1" }),
      }),
    );
  });

  it("redirects when me has no session and parses a dialog list", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async (path: string) => {
      if (path === "/api/auth/me") return jsonResponse(401, { error: "unauthorized" });
      return jsonResponse(200, [
        {
          id: "22222222-2222-4222-8222-222222222222",
          peer: { id: me.id, username: "bob", online: false },
          lastMessage: null,
          unreadCount: 100,
          blocked: false,
        },
      ]);
    });
    const api = createApi(fetchImpl, onUnauthorized);
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await expect(api.listDialogs()).resolves.toMatchObject([{ unreadCount: 100 }]);
  });

  it("opens a dialog on 201 and asks for an older page", async () => {
    const fetchImpl = vi.fn(async (path: string) => {
      if (String(path).startsWith("/api/dialogs?")) {
        return jsonResponse(404, { error: "not_found" });
      }
      if (path === "/api/dialogs") {
        return jsonResponse(201, {
          id: "22222222-2222-4222-8222-222222222222",
          peer: { id: me.id, username: "bob" },
          created: true,
          blocked: false,
        });
      }
      return jsonResponse(200, { messages: [], nextBeforeSeq: null });
    });
    const api = createApi(fetchImpl, vi.fn());
    await expect(api.openDialog("Bob")).resolves.toMatchObject({ created: true });
    await api.history("22222222-2222-4222-8222-222222222222", 4);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/dialogs/22222222-2222-4222-8222-222222222222/messages?beforeSeq=4",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("treats an empty block response as success", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createApi(fetchImpl, vi.fn());
    await expect(api.block("bob")).resolves.toBeUndefined();
    await expect(api.unblock("bob")).resolves.toBeUndefined();
    await expect(api.logout()).resolves.toBeUndefined();
  });
});
