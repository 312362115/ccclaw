import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Button } from '../../components/ui/Button';

interface AuditLog {
  id: string;
  userId: string;
  userName?: string;
  action: string;
  target: string;
  ip: string;
  createdAt: string;
}

export function AdminLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api<AuditLog[]>(`/admin/logs?page=${page}&pageSize=50`).then(setLogs).catch(() => {});
  }, [page]);

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <h2 className="text-[22px] font-bold mb-1.5">管理日志</h2>
        <p className="text-text-muted text-sm">管理员操作记录</p>
      </div>

      <div className="px-7 py-6">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                {['时间', '操作人', '操作', '目标', 'IP'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 text-sm text-text-muted">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-sm font-medium">{log.userName || log.userId}</td>
                  <td className="px-3 py-2.5 text-sm"><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{log.action}</code></td>
                  <td className="px-3 py-2.5 text-sm">{log.target}</td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm text-text-muted">第 {page} 页</span>
          <Button variant="ghost" size="sm" onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      </div>
    </ContentPageShell>
  );
}
