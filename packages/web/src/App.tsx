import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ChatLayout } from './pages/chat/ChatLayout';

function Home() {
  return (
    <div style={{ padding: 24 }}>
      <h2>欢迎使用 CCCLaw</h2>
      <p>请从顶部导航进入对话或控制台。</p>
    </div>
  );
}

// 占位页面（Task 14 实现）
function ConsolePlaceholder() {
  return <div style={{ padding: 24 }}>控制台（Task 14 实现）</div>;
}

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
          <Route index element={<Home />} />
          <Route path="chat" element={<ChatLayout />} />
          <Route path="chat/:workspaceId" element={<ChatLayout />} />
          <Route path="console/*" element={<ConsolePlaceholder />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
