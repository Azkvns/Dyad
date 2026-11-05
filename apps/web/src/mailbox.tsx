import type { ClientFrame, ReportListItem, ReportReason, ServerFrame } from "contracts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import { ApiError, type Api } from "./api";
import { errorText } from "./format";
import { initialLive, reduceLive, type LiveEffect, type LiveEvent, type LiveState } from "./live";
import { BlocksPage } from "./pages/blocks-page";
import { DialogList } from "./pages/dialog-list";
import { ReportsPage } from "./pages/reports-page";
import { ThreadPane } from "./pages/thread-pane";
import { Workspace } from "./pages/workspace";
import { socketUrl, type SocketHandle } from "./socket";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Mailbox({
  api,
  connect,
}: {
  api: Api;
  connect: (options: {
    url: string;
    onFrame: (frame: ServerFrame) => void;
    onReady: () => void;
    onUnauthorized: () => void;
  }) => SocketHandle;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const match = useMatch("/dialogs/:id");
  const routeId = match?.params.id ?? null;
  const dialogId = routeId && uuidPattern.test(routeId) ? routeId : null;
  const [meId, setMeId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [draft, setDraft] = useState("");
  const [peerUsername, setPeerUsername] = useState("");
  const [peerError, setPeerError] = useState<string | null>(null);
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const liveRef = useRef<LiveState | null>(null);
  const sendRef = useRef<((frame: ClientFrame) => void) | null>(null);
  const queued = useRef<ClientFrame[]>([]);
  const apiRef = useRef(api);
  const navigateRef = useRef(navigate);
  apiRef.current = api;
  navigateRef.current = navigate;

  function flush(frame: ClientFrame): void {
    if (sendRef.current) sendRef.current(frame);
    else queued.current.push(frame);
  }

  function dispatch(event: LiveEvent): void {
    const current = liveRef.current;
    if (!current) return;
    const result = reduceLive(current, event);
    liveRef.current = result.state;
    setLive(result.state);
    for (const effect of result.effects) void runEffect(effect);
  }

  async function runEffect(effect: LiveEffect): Promise<void> {
    if (effect.type === "reload-dialogs") {
      dispatch({ type: "dialogs", dialogs: await apiRef.current.listDialogs() });
      return;
    }
    if (effect.type === "reload-history") {
      const id = liveRef.current?.openDialogId;
      if (!id) return;
      dispatch({ type: "history", dialogId: id, page: await apiRef.current.history(id, null) });
      return;
    }
    flush(effect);
  }

  useEffect(() => {
    let cancelled = false;
    let handle: SocketHandle | null = null;
    void (async () => {
      try {
        const user = await api.me();
        if (cancelled) return;
        const state = initialLive(user.id);
        liveRef.current = state;
        setMeId(user.id);
        setLive(state);
        const [dialogs, blocks] = await Promise.all([api.listDialogs(), api.listBlocks()]);
        if (cancelled) return;
        dispatch({ type: "dialogs", dialogs });
        dispatch({ type: "blocks", usernames: blocks.map((item) => item.username) });
        handle = connect({
          url: socketUrl(window.location),
          onFrame: (frame) => {
            if (frame.type === "ready") return;
            dispatch({ type: "frame", frame });
          },
          onReady: () => dispatch({ type: "ready" }),
          onUnauthorized: () => navigateRef.current("/login"),
        });
        sendRef.current = handle.send;
        for (const frame of queued.current) handle.send(frame);
        queued.current = [];
      } catch {
        if (!cancelled) navigateRef.current("/login");
      }
    })();
    return () => {
      cancelled = true;
      handle?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (!meId || !dialogId) return;
    let cancelled = false;
    dispatch({ type: "open", dialogId });
    void api.history(dialogId, null).then((page) => {
      if (!cancelled) dispatch({ type: "history", dialogId, page });
    });
    return () => {
      cancelled = true;
    };
  }, [dialogId, meId]);

  useEffect(() => {
    if (!meId || location.pathname !== "/blocks") return;
    let cancelled = false;
    void api.listBlocks().then((items) => {
      if (!cancelled) dispatch({ type: "blocks", usernames: items.map((item) => item.username) });
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, meId, api]);

  useEffect(() => {
    if (!meId || location.pathname !== "/reports") return;
    let cancelled = false;
    void api.listReports().then((items) => {
      if (!cancelled) setReports(items);
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, meId, api]);

  async function openPeer(): Promise<void> {
    setPeerError(null);
    try {
      const opened = await api.openDialog(peerUsername);
      dispatch({
        type: "ensure-dialog",
        dialog: {
          id: opened.id,
          peer: { id: opened.peer.id, username: opened.peer.username, online: false },
          lastMessage: null,
          unreadCount: 0,
          blocked: opened.blocked,
        },
      });
      setPeerUsername("");
      navigate(`/dialogs/${opened.id}`);
      dispatch({ type: "dialogs", dialogs: await api.listDialogs() });
    } catch (error) {
      setPeerError(error instanceof ApiError ? errorText(error.status, error.body) : "Не получилось выполнить запрос");
    }
  }

  async function toggleBlock(): Promise<void> {
    if (!live || !dialogId) return;
    const current = live.dialogs.find((item) => item.id === dialogId);
    if (!current) return;
    if (live.blockedUsernames.includes(current.peer.username)) await api.unblock(current.peer.username);
    else await api.block(current.peer.username);
    dispatch({ type: "blocks", usernames: (await api.listBlocks()).map((item) => item.username) });
    dispatch({ type: "dialogs", dialogs: await api.listDialogs() });
  }

  async function pickReason(reason: ReportReason): Promise<void> {
    if (!reportMessageId) return;
    try {
      await api.createReport(reportMessageId, reason);
      setReportNote("Жалоба отправлена");
    } catch (error) {
      setReportNote(error instanceof ApiError ? errorText(error.status, error.body) : "Не получилось выполнить запрос");
    }
  }

  if (!live || !meId) return <p className="pick">Загрузка</p>;
  if (location.pathname === "/blocks") {
    return (
      <BlocksPage
        usernames={live.blockedUsernames}
        onUnblock={(username) => {
          void api.unblock(username).then(async () => {
            dispatch({ type: "blocks", usernames: (await api.listBlocks()).map((item) => item.username) });
          });
        }}
      />
    );
  }
  if (location.pathname === "/reports") {
    if (!reports) return <p className="pick">Загрузка</p>;
    return <ReportsPage reports={reports} />;
  }

  const dialog = dialogId ? (live.dialogs.find((item) => item.id === dialogId) ?? null) : null;
  const missing = live.dialogsLoaded && routeId !== null && !dialog;
  return (
    <Workspace
      showThread={routeId !== null}
      list={
        <DialogList
          dialogs={live.dialogs}
          selectedId={dialogId}
          peerUsername={peerUsername}
          peerError={peerError}
          onPeerUsername={setPeerUsername}
          onOpenPeer={() => void openPeer()}
          onLogout={() => void api.logout().then(() => navigate("/login"))}
        />
      }
      thread={
        <ThreadPane
          dialog={dialog}
          missing={missing}
          meId={meId}
          iBlocked={dialog ? live.blockedUsernames.includes(dialog.peer.username) : false}
          confirmed={dialogId === live.openDialogId ? live.confirmed : []}
          outgoing={dialogId === live.openDialogId ? live.outgoing : []}
          nextBeforeSeq={dialogId === live.openDialogId ? live.nextBeforeSeq : null}
          draft={draft}
          reportMessageId={reportMessageId}
          reportNote={reportNote}
          onDraft={setDraft}
          onSend={() => {
            const body = draft.trim();
            if (!body) return;
            dispatch({ type: "compose", clientMsgId: crypto.randomUUID(), body });
            setDraft("");
          }}
          onRetry={(clientMsgId) => dispatch({ type: "retry", clientMsgId })}
          onOlder={() => {
            if (!dialogId || live.nextBeforeSeq === null) return;
            const seq = live.nextBeforeSeq;
            void api.history(dialogId, seq).then((page) => dispatch({ type: "older", dialogId, page }));
          }}
          onToggleBlock={() => void toggleBlock()}
          onReport={(messageId) => {
            setReportMessageId(messageId);
            setReportNote(null);
          }}
          onPickReason={(reason) => void pickReason(reason)}
          onCloseReport={() => setReportMessageId(null)}
        />
      }
    />
  );
}
