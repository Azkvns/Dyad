import { useEffect, useRef, type ReactNode } from "react";

export function Workspace({ showThread, list, thread }: { showThread: boolean; list: ReactNode; thread: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      ref.current?.style.setProperty("--viewport-height", `${viewport.height}px`);
      ref.current?.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);
  return <main ref={ref} className="workspace" data-thread={showThread ? "open" : "closed"}><section className="pane-list" aria-label="Список переписок">{list}</section><section className="pane-thread" aria-label="Переписка">{thread}</section></main>;
}
