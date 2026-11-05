import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, type Api } from "../api";
import { errorText } from "../format";

export function RegisterPage({
  onSubmit,
  error,
  pending,
}: {
  onSubmit: (username: string, password: string) => void;
  error: string | null;
  pending: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <main className="auth">
      <form
        className="auth-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(username, password);
        }}
      >
        <h1 className="auth-mark">Dyad</h1>
        <label>
          Логин
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Пароль
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>Зарегистрироваться</button>
        <Link to="/login">Вход</Link>
      </form>
    </main>
  );
}

export function RegisterRoute({ api }: { api: Api }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <RegisterPage
      error={error}
      pending={pending}
      onSubmit={(username, password) => {
        setPending(true);
        setError(null);
        void api.register(username, password).then(
          () => navigate("/dialogs"),
          (reason: unknown) => {
            setPending(false);
            setError(reason instanceof ApiError ? errorText(reason.status, reason.body) : "Не получилось выполнить запрос");
          },
        );
      }}
    />
  );
}
