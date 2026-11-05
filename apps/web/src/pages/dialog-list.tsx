import type { DialogListItem } from "contracts";
import { Link } from "react-router-dom";
import { formatWhen, tickText, unreadBadge } from "../format";

export type DialogListProps = {
  dialogs: DialogListItem[];
  selectedId: string | null;
  peerUsername: string;
  peerError: string | null;
  onPeerUsername: (value: string) => void;
  onOpenPeer: () => void;
  onLogout: () => void;
};

export function DialogList(props: DialogListProps) {
  return (
    <div>
      <header className="list-head">
        <strong>Dyad</strong>
        <nav className="list-menu">
          <Link to="/blocks">Блокировки</Link>
          <Link to="/reports">Жалобы</Link>
          <button type="button" onClick={props.onLogout}>Выход</button>
        </nav>
      </header>
      <form
        className="peer-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onOpenPeer();
        }}
      >
        <label>
          логин собеседника
          <input value={props.peerUsername} onChange={(event) => props.onPeerUsername(event.target.value)} />
        </label>
        <button type="submit">Открыть</button>
      </form>
      {props.peerError ? <p className="error">{props.peerError}</p> : null}
      {props.dialogs.length === 0 ? <p className="empty">Диалогов пока нет</p> : null}
      <ul className="dialog-list" aria-label="Диалоги">
        {props.dialogs.map((dialog) => {
          const badge = unreadBadge(dialog.unreadCount);
          const ticks = dialog.lastMessage?.senderId ? tickText(dialog.lastMessage.status) : null;
          const showTicks = dialog.lastMessage?.status != null;
          return (
            <li key={dialog.id}>
              <Link
                className={dialog.id === props.selectedId ? "dialog-row is-selected" : "dialog-row"}
                to={`/dialogs/${dialog.id}`}
                aria-current={dialog.id === props.selectedId ? "page" : undefined}
              >
                <span>
                  {dialog.peer.online && !dialog.blocked ? <i className="online" /> : null}
                  {dialog.peer.username}
                </span>
                <span className="meta">
                  {dialog.lastMessage ? formatWhen(dialog.lastMessage.createdAt, new Date()) : ""}
                  {badge ? <span className="badge">{badge}</span> : null}
                </span>
                <span className="preview">
                  {dialog.lastMessage?.body ?? ""}
                  {showTicks && ticks ? <span className={ticks.label === "прочитано" ? "ticks read" : "ticks"} aria-label={ticks.label}>{ticks.marks}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
