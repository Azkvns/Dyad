import {
  blockListItemSchema,
  dialogListItemSchema,
  historyPageSchema,
  openDialogSchema,
  publicUserSchema,
  reportListItemSchema,
  type DialogListItem,
  type HistoryPage,
  type OpenDialog,
  type PublicUser,
  type ReportListItem,
  type ReportReason,
} from "contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: { error: string; fields?: Record<string, string> };

  constructor(status: number, body: { error: string; fields?: Record<string, string> }) {
    super(body.error);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export type Api = {
  register(username: string, password: string): Promise<PublicUser>;
  login(username: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  me(): Promise<PublicUser>;
  openDialog(username: string): Promise<OpenDialog>;
  listDialogs(): Promise<DialogListItem[]>;
  history(dialogId: string, beforeSeq: number | null): Promise<HistoryPage>;
  block(username: string): Promise<void>;
  unblock(username: string): Promise<void>;
  listBlocks(): Promise<{ username: string }[]>;
  createReport(messageId: string, reason: ReportReason): Promise<ReportListItem>;
  listReports(): Promise<ReportListItem[]>;
};

function parseBody(text: string): { error: string; fields?: Record<string, string> } {
  if (!text) return { error: "internal" };
  try {
    const parsed = JSON.parse(text) as { error?: unknown; fields?: Record<string, string> };
    if (typeof parsed.error !== "string") return { error: "internal" };
    return { error: parsed.error, fields: parsed.fields };
  } catch {
    return { error: "internal" };
  }
}

export function createApi(fetchImpl: typeof fetch, onUnauthorized: () => void): Api {
  async function request(path: string, init: RequestInit, redirectOnUnauthorized: boolean): Promise<string> {
    const response = await fetchImpl(path, { ...init, credentials: "include" });
    const text = await response.text();
    if (response.status === 401 && redirectOnUnauthorized) onUnauthorized();
    if (!response.ok) throw new ApiError(response.status, parseBody(text));
    return text;
  }

  function read<T>(path: string, schema: { parse: (data: unknown) => T }): Promise<T> {
    return request(path, { method: "GET" }, true).then((text) => schema.parse(JSON.parse(text)));
  }

  function send<T>(path: string, body: unknown, schema: { parse: (data: unknown) => T }, redirectOnUnauthorized: boolean): Promise<T> {
    return request(
      path,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      redirectOnUnauthorized,
    ).then((text) => schema.parse(JSON.parse(text)));
  }

  async function empty(path: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
    await request(
      path,
      {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      true,
    );
  }

  return {
    register: (username, password) => send("/api/auth/register", { username, password }, publicUserSchema, false),
    login: (username, password) => send("/api/auth/login", { username, password }, publicUserSchema, false),
    logout: () => empty("/api/auth/logout", "POST"),
    me: () => read("/api/auth/me", publicUserSchema),
    openDialog: (username) => send("/api/dialogs", { username }, openDialogSchema, true),
    listDialogs: () => read("/api/dialogs", dialogListItemSchema.array()),
    history: (dialogId, beforeSeq) => {
      const query = beforeSeq === null ? "" : `?beforeSeq=${beforeSeq}`;
      return read(`/api/dialogs/${dialogId}/messages${query}`, historyPageSchema);
    },
    block: (username) => empty("/api/blocks", "POST", { username }),
    unblock: (username) => empty(`/api/blocks/${encodeURIComponent(username)}`, "DELETE"),
    listBlocks: () => read("/api/blocks", blockListItemSchema.array()),
    createReport: (messageId, reason) => send("/api/reports", { messageId, reason }, reportListItemSchema, true),
    listReports: () => read("/api/reports", reportListItemSchema.array()),
  };
}
