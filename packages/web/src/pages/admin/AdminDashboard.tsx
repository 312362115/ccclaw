import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Stats {
  userCount: number;
  workspaceCount: number;
  sessionCount: number;
}

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>('/admin/stats').then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>管理后台</h2>
      {stats ? (
        <div style={{ display: 'flex', gap: 16 }}>
          <StatCard label="用户数" value={stats.userCount} />
          <StatCard label="工作区数" value={stats.workspaceCount} />
          <StatCard label="会话数" value={stats.sessionCount} />
        </div>
      ) : (
        <p style={{ color: '#999' }}>加载中...</p>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, minWidth: 140, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 600, color: '#333' }}>{value}</div>
      <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{label}</div>
    </div>
  );
}
