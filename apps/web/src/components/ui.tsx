import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function Avatar({ username, online = false }: { username: string; online?: boolean }) {
  const tone = [...username].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  return <span className={`avatar avatar-${tone}`} aria-hidden="true">{username.slice(0, 1).toUpperCase()}{online && <i className="online" />}</span>;
}

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(event: PointerEvent | KeyboardEvent) {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        el.open = false;
        el.querySelector("summary")?.focus();
      } else if (!el.contains(event.target as Node)) el.open = false;
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  return <details className="disclosure" ref={ref}><summary aria-label={label} title={label}>⋯</summary><div className="action-menu" onClick={(event) => {
    if ((event.target as Element).closest("button,a") && ref.current) ref.current.open = false;
  }}>{children}</div></details>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    const preferred = el.querySelector<HTMLElement>("[data-autofocus]");
    if (preferred) preferred.setAttribute("autofocus", "");
    if (el.showModal) el.showModal();
    else el.setAttribute("open", "");
    preferred?.focus();
    return () => { el.close?.(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}><header><h2 id={titleId}>{title}</h2><button className="icon-button ghost" type="button" onClick={onClose} aria-label="Закрыть">×</button></header>{children}</dialog>;
}

export function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return <div className="password-field"><label htmlFor={id}>Пароль</label><div className="password-control"><input id={id} value={value} onChange={event => onChange(event.target.value)} type={show ? "text" : "password"} autoComplete={autoComplete} /><button className="ghost" type="button" aria-pressed={show} aria-label={show ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShow(!show)}>{show ? "Скрыть" : "Показать"}</button></div></div>;
}
