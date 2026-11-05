import { Avatar } from "../components/ui";
import { Link } from "react-router-dom";

export function BlocksPage({ usernames, onUnblock, pending = false, error }: { usernames: string[]; onUnblock: (username: string) => void; pending?: boolean; error?: string | null }) {
  return (
    <main className="subpage">
      <header className="sub-head">
        <h1>Блокировки</h1>
        <Link to="/dialogs">К диалогам</Link>
      </header>
      {usernames.length === 0 ? <p className="empty">Блокировок нет</p> : null}
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="block-list">
        {usernames.map((username) => (
          <li key={username}>
            <Avatar username={username} /><span>{username}</span>
            <button className="secondary" disabled={pending} type="button" onClick={() => onUnblock(username)}>Разблокировать</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
