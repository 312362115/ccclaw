import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ChatLayout } from './pages/chat/ChatLayout';
import { ConsoleLayout } from './pages/console/ConsoleLayout';
import { Dashboard } from './pages/console/Dashboard';
import { Workspaces } from './pages/console/Workspaces';
import { Providers } from './pages/console/Providers';
import { Skills } from './pages/console/Skills';
import { Logs } from './pages/console/Logs';
import { Users } from './pages/console/Users';
import { Settings } from './pages/console/Settings';

export function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/console" replace />} />
          <Route path="chat" element={<ChatLayout />} />
          <Route path="chat/:workspaceId" element={<ChatLayout />} />
          <Route path="console" element={<ConsoleLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="workspaces" element={<Workspaces />} />
            <Route path="providers" element={<Providers />} />
            <Route path="skills" element={<Skills />} />
            <Route path="logs" element={<Logs />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
