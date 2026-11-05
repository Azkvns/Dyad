import type { DialogListItem, MessageView, ReportReason } from "contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Disclosure, Modal } from "../components/ui";
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
  historyPending?: boolean;
  olderPending?: boolean;
  actionPending?: boolean;
  reportPending?: boolean;
  actionError?: string | null;
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
  const history = useRef<HTMLDivElement>(null);
  const messages = useRef<HTMLOListElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const previous = useRef({ id: "", first: "", height: 0, top: 0, outgoing: "" });
  const [away, setAway] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const id = props.dialog?.id ?? "";
  const first = props.confirmed[0]?.id ?? "";
  const outgoing = props.outgoing.at(-1)?.clientMsgId ?? "";
  function bottom() {
    const el = history.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
    setAway(false);
  }
  useLayoutEffect(() => {
    const el = history.current;
    if (!el) return;
    const old = previous.current;
    const prepended = old.id === id && old.first && first !== old.first && props.confirmed.some(message => message.id === old.first);
    if (old.id !== id || (outgoing && outgoing !== old.outgoing) || (!prepended && nearBottom.current)) bottom();
    else if (prepended) el.scrollTop = old.top + el.scrollHeight - old.height;
    previous.current = { id, first, outgoing, height: el.scrollHeight, top: el.scrollTop };
  }, [id, first, outgoing, props.confirmed, props.outgoing, props.historyPending]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (nearBottom.current) bottom(); });
    if (history.current) observer.observe(history.current);
    if (messages.current) observer.observe(messages.current);
    return () => observer.disconnect();
  }, [id]);
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [props.draft, id]);
  if (!props.dialog) return <div className="thread-empty"><span className="empty-symbol" aria-hidden="true">↔</span><h1>{props.missing ? "Диалог не найден" : "Выберите диалог"}</h1><p className="quiet">{props.missing ? "Вернитесь к списку или начните новый разговор." : "Откройте переписку слева или начните новый разговор."}</p>{props.missing && <Link to="/dialogs">К диалогам</Link>}</div>;
  const dialog = props.dialog;
  return <div className="thread-panel">
    <header className="thread-head"><Link className="thread-back icon-button ghost" to="/dialogs" aria-label="Назад">←</Link><Avatar username={dialog.peer.username} /><div className="thread-identity"><h1 title={dialog.peer.username}>{dialog.peer.username}</h1>{!dialog.blocked && <p className="quiet">{dialog.peer.online ? "в сети" : "не в сети"}</p>}</div><Disclosure label="Действия диалога"><button className="danger ghost" type="button" disabled={props.actionPending} onClick={() => props.iBlocked ? props.onToggleBlock() : setConfirmBlock(true)}>{props.iBlocked ? "Разблокировать" : "Заблокировать"}</button></Disclosure></header>
    {props.actionError && <p className="error pane-note" role="alert">{props.actionError}</p>}
    <div className="history-wrap"><div className="history" ref={history} onScroll={() => {
      const el = history.current!;
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
      setAway(!nearBottom.current);
      previous.current = { ...previous.current, top: el.scrollTop, height: el.scrollHeight };
    }}>
      {props.nextBeforeSeq !== null && <div className="older"><button className="secondary" type="button" disabled={props.olderPending} onClick={props.onOlder}>{props.olderPending ? "Загрузка…" : "Раньше"}</button></div>}
      {props.historyPending ? <p className="empty" role="status">Загрузка сообщений…</p> : props.confirmed.length === 0 && props.outgoing.length === 0 ? <p className="empty">Сообщений пока нет. Напишите первым.</p> : null}
      <ol className="messages" ref={messages} aria-label="Сообщения">{props.confirmed.map(message => {
        const mine = message.senderId === props.meId;
        const ticks = tickText(message.status);
        return <li key={message.id} className={mine ? "bubble mine" : "bubble"}><p>{message.body}</p><div className="message-meta"><time dateTime={message.createdAt}>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>{mine && ticks && <span className={message.status === "read" ? "ticks read" : "ticks"} aria-label={ticks.label}>{ticks.marks}</span>}{!mine && <Disclosure label="Действия сообщения"><button className="ghost" type="button" onClick={() => props.onReport(message.id)}>Пожаловаться</button></Disclosure>}</div></li>;
      })}{props.outgoing.map(bubble => <li key={bubble.clientMsgId} className="bubble mine"><p>{bubble.body}</p><div className="message-meta">{bubble.state === "failed" ? <span className="failed">не отправлено <button className="ghost" type="button" onClick={() => props.onRetry(bubble.clientMsgId)}>Повторить</button></span> : <span aria-label="Отправляется">Отправляется…</span>}</div></li>)}</ol>
    </div>{away && <button type="button" className="latest secondary" onClick={bottom}>К последним сообщениям ↓</button>}</div>
    {props.reportNote && !props.reportMessageId && <p className="pane-note quiet" role="status">{props.reportNote}</p>}
    {dialog.blocked ? <p className="unavailable">Сообщения недоступны</p> : <form noValidate className="composer" onSubmit={event => { event.preventDefault(); if (props.draft.trim()) { bottom(); props.onSend(); } }}><label className="sr-only" htmlFor="message-draft">Сообщение</label><textarea className="composer-input" id="message-draft" ref={textarea} rows={1} maxLength={2000} placeholder="Написать сообщение…" value={props.draft} onChange={event => props.onDraft(event.target.value)} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !window.matchMedia?.("(pointer: coarse)").matches) {
        event.preventDefault(); if (props.draft.trim()) { bottom(); props.onSend(); }
      }
    }} /><button className="icon-button send-button" type="submit" disabled={!props.draft.trim()} aria-label="Отправить" title="Отправить">↑</button></form>}
    {confirmBlock && <Modal title={`Заблокировать ${dialog.peer.username}?`} onClose={() => setConfirmBlock(false)}><p>Отправка сообщений в этом диалоге станет недоступна. Блокировку можно снять в любой момент.</p><div className="modal-actions"><button data-autofocus className="secondary" onClick={() => setConfirmBlock(false)}>Отмена</button><button className="danger" disabled={props.actionPending} onClick={() => { setConfirmBlock(false); props.onToggleBlock(); }}>Заблокировать</button></div></Modal>}
    {props.reportMessageId && <Modal title="Пожаловаться на сообщение" onClose={props.onCloseReport}><p className="quiet">Выберите причину жалобы.</p><div className="report-menu">{([['spam', 'спам'], ['abuse', 'оскорбление'], ['other', 'другое']] as const).map(([reason, label]) => <button className="secondary" key={reason} disabled={props.reportPending} onClick={() => props.onPickReason(reason)}>{label}</button>)}</div>{props.reportPending && <p role="status">Отправляем жалобу…</p>}{props.reportNote && <p role="status">{props.reportNote}</p>}</Modal>}
  </div>;
}
