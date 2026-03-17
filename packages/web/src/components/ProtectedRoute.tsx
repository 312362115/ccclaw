import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-bg">
        <div className="text-center">
          <div className="w-10 h-10 rounded-xl mx-auto mb-4 flex items-center justify-center text-white font-extrabold text-[13px]"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}
          >
            CC
          </div>
          <p className="text-text-muted text-sm animate-pulse-dot">加载中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
