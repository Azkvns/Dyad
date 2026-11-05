import type { DialogListItem } from "contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Disclosure, Modal } from "../components/ui";
import { formatWhen, tickText, unreadBadge } from "../format";

export type DialogListProps = {
  dialogs: DialogListItem[];
  selectedId: string | null;
  peerUsername: string;
  peerError: string | null;
  peerPending?: boolean;
  loading?: boolean;
  onPeerUsername: (value: string) => void;
  onOpenPeer: () => void;
  onLogout: () => void;
};

export function DialogList(props: DialogListProps) {
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (!props.peerPending && !props.peerError && !props.peerUsername) setCreating(false); }, [props.peerPending, props.peerError, props.peerUsername]);
  return <div className="list-panel">
    <header className="list-head"><strong className="brand">Dyad</strong><Disclosure label="Меню приложения"><Link to="/blocks">Блокировки</Link><Link to="/reports">Жалобы</Link><button className="danger ghost" type="button" onClick={props.onLogout}>Выход</button></Disclosure></header>
    <div className="list-title"><h1>Сообщения</h1><button type="button" className="icon-button" aria-label="Новый диалог" title="Новый диалог" onClick={() => setCreating(true)}>＋</button></div>
    <div className="dialog-scroll">
      {props.loading ? <p className="empty" role="status">Загрузка диалогов…</p> : props.dialogs.length === 0 ? <div className="empty"><p>Диалогов пока нет</p><p className="quiet">Начните разговор по логину собеседника.</p><button className="secondary" onClick={() => setCreating(true)}>Новый диалог</button></div> : null}
      <ul className="dialog-list" aria-label="Диалоги">{props.dialogs.map(dialog => {
        const badge = unreadBadge(dialog.unreadCount);
        const ticks = dialog.lastMessage ? tickText(dialog.lastMessage.status) : null;
        return <li key={dialog.id}><Link className={`dialog-row${dialog.id === props.selectedId ? " is-selected" : ""}${badge ? " has-unread" : ""}`} to={`/dialogs/${dialog.id}`} aria-current={dialog.id === props.selectedId ? "page" : undefined}>
          <Avatar username={dialog.peer.username} online={dialog.peer.online && !dialog.blocked} />
          <span className="dialog-copy"><strong title={dialog.peer.username}>{dialog.peer.username}</strong><span className="preview">{ticks && <span className={ticks.label === "прочитано" ? "ticks read" : "ticks"} aria-label={ticks.label}>{ticks.marks}</span>}{dialog.lastMessage?.body || "Начните разговор"}</span></span>
          <span className="meta">{dialog.lastMessage && <time dateTime={dialog.lastMessage.createdAt}>{formatWhen(dialog.lastMessage.createdAt, new Date())}</time>}{dialog.blocked ? <span aria-label="Заблокирован">⊘</span> : badge ? <span className="badge" aria-label={`Непрочитанных: ${dialog.unreadCount}`}>{badge}</span> : null}</span>
        </Link></li>;
      })}</ul>
    </div>
    {creating && <Modal title="Новый диалог" onClose={() => setCreating(false)}><p className="quiet">Введите точный логин собеседника.</p><form noValidate className="peer-form" onSubmit={event => { event.preventDefault(); if (!props.peerPending && props.peerUsername.trim()) props.onOpenPeer(); }}><label>логин собеседника<input autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} value={props.peerUsername} aria-invalid={!!props.peerError} aria-describedby={props.peerError ? "peer-error" : undefined} onChange={event => props.onPeerUsername(event.target.value)} /></label>{props.peerError && <p id="peer-error" className="error" role="alert">{props.peerError}</p>}<button type="submit" disabled={props.peerPending || !props.peerUsername.trim()} aria-busy={props.peerPending}>{props.peerPending ? "Открываем…" : "Открыть"}</button></form></Modal>}
  </div>;
}
