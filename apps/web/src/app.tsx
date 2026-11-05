import { useCallback, useEffect, useMemo, useRef } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { createApi } from "./api";
import { Mailbox } from "./mailbox";
import { LoginRoute } from "./pages/login-page";
import { RegisterRoute } from "./pages/register-page";
import { connectSocket } from "./socket";

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const title = location.pathname === "/login" ? "Вход" : location.pathname === "/register" ? "Регистрация" : location.pathname === "/blocks" ? "Блокировки" : location.pathname === "/reports" ? "Жалобы" : "Сообщения";
    document.title = `${title} — Dyad`;
  }, [location.pathname]);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const onUnauthorized = useCallback(() => navigateRef.current("/login"), []);
  const api = useMemo(() => createApi(fetch, onUnauthorized), [onUnauthorized]);
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute api={api} />} />
      <Route path="/register" element={<RegisterRoute api={api} />} />
      <Route path="/*" element={<Mailbox api={api} connect={connectSocket} />} />
    </Routes>
  );
}
