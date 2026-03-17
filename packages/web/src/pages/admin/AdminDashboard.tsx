import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Card } from '../../components/ui/Card';

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
    <ContentPageShell>
      <div className="px-7 pt-7">
        <h2 className="text-[22px] font-bold mb-1.5">管理后台</h2>
        <p className="text-text-muted text-sm">系统概览</p>
      </div>
      <div className="px-7 py-6">
        {stats ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
            <Card label="用户数" value={stats.userCount} />
            <Card label="工作区数" value={stats.workspaceCount} />
            <Card label="会话数" value={stats.sessionCount} />
          </div>
        ) : (
          <p className="text-text-muted text-sm">加载中...</p>
        )}
      </div>
    </ContentPageShell>
  );
}
