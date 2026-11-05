import type { ReactNode } from "react";

export function Workspace({ showThread, list, thread }: { showThread: boolean; list: ReactNode; thread: ReactNode }) {
  return (
    <div className="workspace" data-thread={showThread ? "open" : "closed"}>
      <section className="pane-list">{list}</section>
      <section className="pane-thread">{thread}</section>
    </div>
  );
}
