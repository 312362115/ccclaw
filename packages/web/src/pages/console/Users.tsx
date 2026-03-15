import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export function Users() {
  const [users, setUsers] = useState<User[]>([]);

  const load = () => api<User[]>('/users').then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleRole = async (user: User) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    await api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
    load();
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>用户管理</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>姓名</th>
            <th style={thStyle}>邮箱</th>
            <th style={thStyle}>角色</th>
            <th style={thStyle}>注册时间</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>{u.name}</td>
              <td style={tdStyle}>{u.email}</td>
              <td style={tdStyle}>{u.role === 'admin' ? '管理员' : '用户'}</td>
              <td style={tdStyle}>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td style={tdStyle}>
                <button onClick={() => toggleRole(u)} style={{ background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 13 }}>
                  {u.role === 'admin' ? '降为用户' : '提升管理员'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
