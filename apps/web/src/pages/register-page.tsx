import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, type Api } from "../api";
import { PasswordField } from "../components/ui";
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
      <form noValidate
        className="auth-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) onSubmit(username, password);
        }}
      >
        <h1 className="auth-mark">Dyad</h1>
        <h2 className="auth-heading">Создать аккаунт</h2>
        <label>
          Логин
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />
        {error ? <p className="error" role="alert">{error}</p> : null}
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
        if (pending) return;
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
