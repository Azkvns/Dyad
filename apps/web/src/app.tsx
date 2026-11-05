import { useCallback, useMemo } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { createApi } from "./api";
import { LoginRoute } from "./pages/login-page";
import { RegisterRoute } from "./pages/register-page";

export function App() {
  const navigate = useNavigate();
  const onUnauthorized = useCallback(() => navigate("/login"), [navigate]);
  const api = useMemo(() => createApi(fetch, onUnauthorized), [onUnauthorized]);
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute api={api} />} />
      <Route path="/register" element={<RegisterRoute api={api} />} />
      <Route path="/*" element={<p className="pick">Загрузка</p>} />
    </Routes>
  );
}
