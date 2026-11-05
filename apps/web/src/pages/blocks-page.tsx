import { Link } from "react-router-dom";

export function BlocksPage({ usernames, onUnblock }: { usernames: string[]; onUnblock: (username: string) => void }) {
  return (
    <main className="subpage">
      <header className="sub-head">
        <h1>Блокировки</h1>
        <Link to="/dialogs">К диалогам</Link>
      </header>
      {usernames.length === 0 ? <p className="empty">Блокировок нет</p> : null}
      <ul className="block-list">
        {usernames.map((username) => (
          <li key={username}>
            <span>{username}</span>
            <button type="button" onClick={() => onUnblock(username)}>Разблокировать</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
