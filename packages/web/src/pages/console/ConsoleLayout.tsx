import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

const navItems = [
  { path: '/console', label: '概览', end: true },
  { path: '/console/workspaces', label: '工作区' },
  { path: '/console/providers', label: 'API Key' },
  { path: '/console/skills', label: '技能' },
  { path: '/console/logs', label: '审计日志', adminOnly: true },
  { path: '/console/users', label: '用户管理', adminOnly: true },
  { path: '/console/settings', label: '设置' },
];

export function ConsoleLayout() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
      <nav style={{ width: 200, borderRight: '1px solid #e0e0e0', padding: '16px 0', overflow: 'auto' }}>
        {navItems
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={'end' in item ? item.end : false}
              style={({ isActive }) => ({
                display: 'block',
                padding: '8px 20px',
                color: isActive ? '#1a73e8' : '#333',
                background: isActive ? '#e8f0fe' : 'transparent',
                textDecoration: 'none',
                fontSize: 14,
              })}
            >
              {item.label}
            </NavLink>
          ))}
      </nav>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <Outlet />
      </div>
    </div>
  );
}
