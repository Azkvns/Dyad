import { useCallback, useMemo } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { createApi } from "./api";
import { Mailbox } from "./mailbox";
import { LoginRoute } from "./pages/login-page";
import { RegisterRoute } from "./pages/register-page";
import { connectSocket } from "./socket";

export function App() {
  const navigate = useNavigate();
  const onUnauthorized = useCallback(() => navigate("/login"), [navigate]);
  const api = useMemo(() => createApi(fetch, onUnauthorized), [onUnauthorized]);
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute api={api} />} />
      <Route path="/register" element={<RegisterRoute api={api} />} />
      <Route path="/*" element={<Mailbox api={api} connect={connectSocket} />} />
    </Routes>
  );
}
