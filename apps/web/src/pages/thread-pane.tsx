import type { DialogListItem, MessageView, ReportReason } from "contracts";
import { Link } from "react-router-dom";
import { tickText } from "../format";
import type { Outgoing } from "../live";

export type ThreadPaneProps = {
  dialog: DialogListItem | null;
  missing: boolean;
  meId: string;
  iBlocked: boolean;
  confirmed: MessageView[];
  outgoing: Outgoing[];
  nextBeforeSeq: number | null;
  draft: string;
  reportMessageId: string | null;
  reportNote: string | null;
  onDraft: (value: string) => void;
  onSend: () => void;
  onRetry: (clientMsgId: string) => void;
  onOlder: () => void;
  onToggleBlock: () => void;
  onReport: (messageId: string) => void;
  onPickReason: (reason: ReportReason) => void;
  onCloseReport: () => void;
};

export function ThreadPane(props: ThreadPaneProps) {
  if (!props.dialog) {
    return <p className={props.missing ? "missing" : "pick"}>{props.missing ? "Диалог не найден" : "Выберите диалог"}</p>;
  }
  const dialog = props.dialog;
  return (
    <div>
      <header className="thread-head">
        <div>
          <Link className="thread-back" to="/dialogs">Назад</Link>
          <h1>{dialog.peer.username}</h1>
          {dialog.blocked ? null : <p className="quiet">{dialog.peer.online ? "в сети" : "не в сети"}</p>}
        </div>
        <button type="button" onClick={props.onToggleBlock}>{props.iBlocked ? "Разблокировать" : "Заблокировать"}</button>
      </header>
      {props.nextBeforeSeq !== null ? <button type="button" onClick={props.onOlder}>Раньше</button> : null}
      <ol className="messages" aria-label="Сообщения">
        {props.confirmed.map((message) => {
          const mine = message.senderId === props.meId;
          const ticks = tickText(message.status);
          return (
            <li key={message.id} className={mine ? "bubble mine" : "bubble"}>
              <p>{message.body}</p>
              {mine && ticks ? <span className={message.status === "read" ? "ticks read" : "ticks"} aria-label={ticks.label}>{ticks.marks}</span> : null}
              {!mine ? <button type="button" onClick={() => props.onReport(message.id)}>Пожаловаться</button> : null}
              {!mine && props.reportMessageId === message.id ? (
                <div className="report-menu">
                  <button type="button" onClick={() => props.onPickReason("spam")}>спам</button>
                  <button type="button" onClick={() => props.onPickReason("abuse")}>оскорбление</button>
                  <button type="button" onClick={() => props.onPickReason("other")}>другое</button>
                  <button type="button" onClick={props.onCloseReport}>Закрыть</button>
                </div>
              ) : null}
            </li>
          );
        })}
        {props.outgoing.map((bubble) => (
          <li key={bubble.clientMsgId} className="bubble mine">
            <p>{bubble.body}</p>
            {bubble.state === "failed" ? (
              <p className="failed">
                не отправлено <button type="button" onClick={() => props.onRetry(bubble.clientMsgId)}>Повторить</button>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {props.reportNote ? <p className="quiet">{props.reportNote}</p> : null}
      {dialog.blocked ? <p className="unavailable">Сообщения недоступны</p> : (
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (props.draft.trim()) props.onSend();
          }}
        >
          <label>
            Сообщение
            <textarea
              value={props.draft}
              onChange={(event) => props.onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (props.draft.trim()) props.onSend();
                }
              }}
            />
          </label>
          <button type="submit" disabled={!props.draft.trim()}>Отправить</button>
        </form>
      )}
    </div>
  );
}
