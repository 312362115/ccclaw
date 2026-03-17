import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import {
  ChatIcon,
  DashboardIcon,
  WorkspaceIcon,
  KeyIcon,
  SkillIcon,
  LogIcon,
  SettingsIcon,
  AdminIcon,
} from './icons';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
}

const mainNav: NavItem[] = [
  { to: '/chat', icon: ChatIcon, label: '对话' },
  { to: '/tasks', icon: DashboardIcon, label: '概览', end: true },
  { to: '/workspaces', icon: WorkspaceIcon, label: '工作区' },
  { to: '/providers', icon: KeyIcon, label: 'API Key' },
  { to: '/skills', icon: SkillIcon, label: '技能' },
  { to: '/logs', icon: LogIcon, label: '日志' },
  { to: '/settings', icon: SettingsIcon, label: '设置' },
];

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group ${
          isActive
            ? 'bg-blue-500/20 text-blue-300'
            : 'text-slate-400 hover:bg-white/8 hover:text-slate-200'
        }`
      }
    >
      <Icon className="w-5 h-5" />
      <span className="absolute left-[52px] bg-slate-800 text-slate-100 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 -translate-x-1 pointer-events-none transition-all duration-200 shadow-md group-hover:opacity-100 group-hover:translate-x-0 z-50">
        {item.label}
      </span>
    </NavLink>
  );
}

export function IconSidebar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = user?.name?.slice(0, 1).toUpperCase() || '?';

  return (
    <div className="w-16 min-w-16 flex flex-col items-center py-3 pb-4 gap-1 z-20"
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #111827 100%)' }}
    >
      {/* Logo */}
      <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center text-white font-extrabold text-[13px] tracking-tight mb-4"
        style={{
          background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
        }}
      >
        CC
      </div>

      {/* 主导航 */}
      {mainNav.map((item) => (
        <SidebarLink key={item.to} item={item} />
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* 管理后台入口 — 仅 admin 可见 */}
      {isAdmin && (
        <NavLink
          to="/admin"
          className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group text-slate-400 hover:bg-white/8 hover:text-slate-200 mb-2"
        >
          <AdminIcon className="w-5 h-5" />
          <span className="absolute left-[52px] bg-slate-800 text-slate-100 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 -translate-x-1 pointer-events-none transition-all duration-200 shadow-md group-hover:opacity-100 group-hover:translate-x-0 z-50">
            管理后台
          </span>
        </NavLink>
      )}

      {/* 头像 */}
      <div className="relative group">
        <button
          onClick={handleLogout}
          className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-slate-200 text-xs font-bold transition-transform duration-200 hover:scale-108 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #475569, #334155)' }}
        >
          {initials}
        </button>
        <span className="absolute left-[52px] bottom-0 bg-slate-800 text-slate-100 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap opacity-0 -translate-x-1 pointer-events-none transition-all duration-200 shadow-md group-hover:opacity-100 group-hover:translate-x-0 z-50">
          退出登录
        </span>
      </div>
    </div>
  );
}
