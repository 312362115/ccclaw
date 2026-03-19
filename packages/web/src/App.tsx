import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { Login } from './pages/Login';
import { AppShell } from './components/AppShell';
import { AdminShell } from './components/AdminShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ChatPage } from './pages/chat/ChatPage';
import { Tasks } from './pages/console/Tasks';
import { Workspaces } from './pages/console/Workspaces';
import { Providers } from './pages/console/Providers';
import { Skills } from './pages/console/Skills';
import { SkillMarketplace } from './pages/console/SkillMarketplace';
import { Logs } from './pages/console/Logs';
import { Settings } from './pages/console/Settings';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { Users } from './pages/admin/Users';
import { InviteCodes } from './pages/admin/InviteCodes';
import { AdminLogs } from './pages/admin/AdminLogs';

export function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return (
    <ToastProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* 普通用户工作台 */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:workspaceId" element={<ChatPage />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="workspaces" element={<Workspaces />} />
          <Route path="providers" element={<Providers />} />
          <Route path="skills" element={<Skills />} />
          <Route path="skill-marketplace" element={<SkillMarketplace />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* 管理后台 — 完全独立的 Shell */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<Users />} />
          <Route path="invite-codes" element={<InviteCodes />} />
          <Route path="logs" element={<AdminLogs />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ToastProvider>
  );
}
