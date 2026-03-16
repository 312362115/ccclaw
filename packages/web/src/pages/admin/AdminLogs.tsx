import { useState, useEffect } from 'react';
import { api } from '../../api/client';

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
    <div>
      <h2 style={{ marginTop: 0 }}>管理日志</h2>
      <p style={{ fontSize: 13, color: '#888', marginTop: -8, marginBottom: 16 }}>管理员操作记录</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>时间</th>
            <th style={thStyle}>操作人</th>
            <th style={thStyle}>操作</th>
            <th style={thStyle}>目标</th>
            <th style={thStyle}>IP</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>{new Date(log.createdAt).toLocaleString()}</td>
              <td style={tdStyle}>{log.userName || log.userId}</td>
              <td style={tdStyle}><code>{log.action}</code></td>
              <td style={tdStyle}>{log.target}</td>
              <td style={tdStyle}>{log.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pageBtnStyle}>上一页</button>
        <span style={{ fontSize: 14, lineHeight: '30px' }}>第 {page} 页</span>
        <button onClick={() => setPage(page + 1)} style={pageBtnStyle}>下一页</button>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
const pageBtnStyle: React.CSSProperties = { padding: '4px 12px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 };
