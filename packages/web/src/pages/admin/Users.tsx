import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';

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
    <ContentPageShell>
      <div className="px-7 pt-7">
        <h2 className="text-[22px] font-bold mb-1.5">用户管理</h2>
        <p className="text-text-muted text-sm">管理平台用户</p>
      </div>
      <div className="px-7 py-6">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                {['姓名', '邮箱', '角色', '注册时间', '操作'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 text-sm font-medium">{u.name}</td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{u.email}</td>
                  <td className="px-3 py-2.5 text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] ${
                      u.role === 'admin' ? 'bg-accent-soft text-accent' : 'bg-slate-100 text-text-muted'
                    }`}>
                      {u.role === 'admin' ? '管理员' : '用户'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => toggleRole(u)} className="text-accent text-[13px] hover:underline">
                      {u.role === 'admin' ? '降为用户' : '提升管理员'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ContentPageShell>
  );
}
