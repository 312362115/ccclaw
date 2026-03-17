import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import {
  AdminIcon,
  UsersIcon,
  TicketIcon,
  LogIcon,
  ChatIcon,
} from './icons';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
}

const adminNav: NavItem[] = [
  { to: '/admin', icon: AdminIcon, label: '概览', end: true },
  { to: '/admin/users', icon: UsersIcon, label: '用户管理' },
  { to: '/admin/invite-codes', icon: TicketIcon, label: '邀请码' },
  { to: '/admin/logs', icon: LogIcon, label: '管理日志' },
];

export function AdminShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  if (user?.role !== 'admin') {
    return <Navigate to="/chat" replace />;
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = user?.name?.slice(0, 1).toUpperCase() || '?';

  return (
    <div className="flex h-dvh w-screen">
      {/* Admin 侧边栏 — 红色调 */}
      <div className="w-16 min-w-16 flex flex-col items-center py-3 pb-4 gap-1 z-20"
        style={{ background: 'linear-gradient(180deg, #1c1917 0%, #292524 100%)' }}
      >
        {/* Admin Logo */}
        <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center text-white font-extrabold text-[11px] tracking-tight mb-4"
          style={{
            background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
          }}
        >
          ADM
        </div>

        {/* Admin 导航 */}
        {adminNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group ${
                  isActive
                    ? 'bg-red-500/20 text-red-300'
                    : 'text-stone-400 hover:bg-white/8 hover:text-stone-200'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="absolute left-[52px] bg-stone-800 text-stone-100 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 -translate-x-1 pointer-events-none transition-all duration-200 shadow-md group-hover:opacity-100 group-hover:translate-x-0 z-50">
                {item.label}
              </span>
            </NavLink>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* 返回工作台 */}
        <NavLink
          to="/chat"
          className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group text-stone-400 hover:bg-white/8 hover:text-stone-200 mb-2"
        >
          <ChatIcon className="w-5 h-5" />
          <span className="absolute left-[52px] bg-stone-800 text-stone-100 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 -translate-x-1 pointer-events-none transition-all duration-200 shadow-md group-hover:opacity-100 group-hover:translate-x-0 z-50">
            返回工作台
          </span>
        </NavLink>

        {/* 头像 */}
        <div className="relative group">
          <button
            onClick={handleLogout}
            className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-stone-200 text-xs font-bold transition-transform duration-200 hover:scale-108 cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #78716c, #57534e)' }}
          >
            {initials}
          </button>
          <span className="absolute left-[52px] bottom-0 bg-stone-800 text-stone-100 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 -translate-x-1 pointer-events-none transition-all duration-200 shadow-md group-hover:opacity-100 group-hover:translate-x-0 z-50">
            退出登录
          </span>
        </div>
      </div>

      {/* Admin 主内容 */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
