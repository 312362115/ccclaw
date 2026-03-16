import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

const navItems = [
  { path: '/admin', label: '概览', end: true },
  { path: '/admin/users', label: '用户管理' },
  { path: '/admin/invite-codes', label: '邀请码' },
  { path: '/admin/logs', label: '管理日志' },
];

export function AdminLayout() {
  const user = useAuthStore((s) => s.user);

  if (user?.role !== 'admin') {
    return <Navigate to="/console" replace />;
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
      <nav style={{ width: 200, borderRight: '1px solid #e0e0e0', padding: '16px 0', overflow: 'auto' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={'end' in item ? item.end : false}
            style={({ isActive }) => ({
              display: 'block',
              padding: '8px 20px',
              color: isActive ? '#c62828' : '#333',
              background: isActive ? '#ffebee' : 'transparent',
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
