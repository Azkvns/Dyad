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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = dialogId ? drafts[dialogId] ?? "" : "";
  const [peerPending, setPeerPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [olderPending, setOlderPending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unavailableId, setUnavailableId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const locks = useRef(new Set<string>());
  const activeRoute = useRef(location.pathname);
  activeRoute.current = location.pathname;
  const reportTarget = useRef<string | null>(null);
  function failure(error: unknown): string {
    return error instanceof ApiError ? errorText(error.status, error.body) : "Не получилось выполнить запрос. Попробуйте ещё раз.";
  }
  function setDraft(value: string) {
    if (dialogId) setDrafts(current => ({ ...current, [dialogId]: value }));
  }
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
    for (const effect of result.effects) void runEffect(effect).catch(error => setLoadError(failure(error)));
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
        if (!liveRef.current || liveRef.current.meId !== user.id) {
          const state = initialLive(user.id);
          liveRef.current = state;
          setLive(state);
        }
        setMeId(user.id);
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
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) navigateRef.current("/login");
          else setLoadError(failure(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      handle?.close();
      sendRef.current = null;
    };
  }, [connect, reload]);

  useEffect(() => {
    if (!meId || !dialogId) return;
    let cancelled = false;
    setHistoryPending(true);
    setUnavailableId(null);
    setActionError(null);
    setReportMessageId(null);
    reportTarget.current = null;
    setReportNote(null);
    dispatch({ type: "open", dialogId });
    void api.history(dialogId, null).then((page) => {
      if (!cancelled) dispatch({ type: "history", dialogId, page });
    }).catch(error => { if (!cancelled) {
      if (error instanceof ApiError && error.status === 404) setUnavailableId(dialogId);
      else setLoadError(failure(error));
    } }).finally(() => { if (!cancelled) setHistoryPending(false); });
    return () => {
      cancelled = true;
    };
  }, [dialogId, meId, reload]);

  useEffect(() => {
    if (!meId || location.pathname !== "/blocks") return;
    let cancelled = false;
    void api.listBlocks().then((items) => {
      if (!cancelled) dispatch({ type: "blocks", usernames: items.map((item) => item.username) });
    }).catch(error => { if (!cancelled) setLoadError(failure(error)); });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, meId, api, reload]);

  useEffect(() => {
    if (!meId || location.pathname !== "/reports") return;
    let cancelled = false;
    void api.listReports().then((items) => {
      if (!cancelled) setReports(items);
    }).catch(error => { if (!cancelled) setLoadError(failure(error)); });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, meId, api, reload]);

  async function openPeer(): Promise<void> {
    if (locks.current.has("peer")) return;
    locks.current.add("peer");
    setPeerPending(true);
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
      void api.listDialogs().then(dialogs => dispatch({ type: "dialogs", dialogs })).catch(error => setLoadError(failure(error)));
    } catch (error) {
      setPeerError(failure(error));
    } finally { locks.current.delete("peer"); setPeerPending(false); }
  }

  async function changeBlock(username: string, unblock: boolean): Promise<void> {
    if (locks.current.has("block")) return;
    locks.current.add("block"); setActionPending(true); setActionError(null);
    const route = activeRoute.current;
    try {
      if (unblock) await api.unblock(username); else await api.block(username);
      const [blocks, dialogs] = await Promise.all([api.listBlocks(), api.listDialogs()]);
      dispatch({ type: "blocks", usernames: blocks.map(item => item.username) });
      dispatch({ type: "dialogs", dialogs });
    } catch (error) { if (route === activeRoute.current) setActionError(failure(error)); }
    finally { locks.current.delete("block"); setActionPending(false); }
  }

  async function toggleBlock(): Promise<void> {
    const current = live?.dialogs.find(item => item.id === dialogId);
    if (current) await changeBlock(current.peer.username, live!.blockedUsernames.includes(current.peer.username));
  }

  async function pickReason(reason: ReportReason): Promise<void> {
    if (!reportMessageId || locks.current.has("report")) return;
    const target = reportMessageId;
    locks.current.add("report"); setReportPending(true);
    try {
      await api.createReport(target, reason);
      if (reportTarget.current === target) { setReportNote("Жалоба отправлена"); setReportMessageId(null); }
    } catch (error) { if (reportTarget.current === target) setReportNote(failure(error)); }
    finally { locks.current.delete("report"); setReportPending(false); }
  }

  async function older(): Promise<void> {
    if (!dialogId || !live || live.nextBeforeSeq === null || locks.current.has("older")) return;
    locks.current.add("older"); setOlderPending(true); setActionError(null);
    const route = activeRoute.current;
    try {
      const page = await api.history(dialogId, live.nextBeforeSeq);
      dispatch({ type: "older", dialogId, page });
    } catch (error) { if (activeRoute.current === route) setActionError(failure(error)); }
    finally { locks.current.delete("older"); setOlderPending(false); }
  }

  const retryLoad = () => { setLoadError(null); setReload(value => value + 1); };
  if (loadError) return <main className="subpage"><h1>Не удалось загрузить данные</h1><p className="error" role="alert">{loadError}</p><button onClick={retryLoad}>Повторить</button></main>;
  if (!live || !meId) return <p className="pick">Загрузка</p>;
  if (location.pathname === "/blocks") {
    return (
      <BlocksPage
        usernames={live.blockedUsernames}
        pending={actionPending}
        error={actionError}
        onUnblock={(username) => void changeBlock(username, true)}
      />
    );
  }
  if (location.pathname === "/reports") {
    if (!reports) return <p className="pick">Загрузка</p>;
    return <ReportsPage reports={reports} />;
  }

  const dialog = dialogId && unavailableId !== dialogId ? (live.dialogs.find((item) => item.id === dialogId) ?? null) : null;
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
          peerPending={peerPending}
          loading={!live.dialogsLoaded}
          onPeerUsername={setPeerUsername}
          onOpenPeer={() => void openPeer()}
          onLogout={() => {
            if (locks.current.has("logout")) return;
            locks.current.add("logout");
            void api.logout().then(() => navigate("/login")).catch(error => setLoadError(failure(error))).finally(() => locks.current.delete("logout"));
          }}
        />
      }
      thread={
        <ThreadPane
          key={dialogId ?? "empty"}
          dialog={dialog}
          historyPending={historyPending}
          olderPending={olderPending}
          actionPending={actionPending}
          reportPending={reportPending}
          actionError={actionError}
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
            if (!body || live.openDialogId !== dialogId || dialog?.blocked) return;
            dispatch({ type: "compose", clientMsgId: crypto.randomUUID(), body });
            setDraft("");
          }}
          onRetry={(clientMsgId) => dispatch({ type: "retry", clientMsgId })}
          onOlder={() => void older()}
          onToggleBlock={() => void toggleBlock()}
          onReport={(messageId) => {
            reportTarget.current = messageId;
            setReportMessageId(messageId);
            setReportNote(null);
          }}
          onPickReason={(reason) => void pickReason(reason)}
          onCloseReport={() => { reportTarget.current = null; setReportMessageId(null); setReportNote(null); }}
        />
      }
    />
  );
}
