import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface InviteCode {
  id: string;
  code: string;
  usedBy: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function InviteCodes() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [generating, setGenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);

  const load = () => api<InviteCode[]>('/invite-codes').then(setCodes).catch(() => {});
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const data = await api<{ codes: string[] }>('/invite-codes', {
        method: 'POST',
        body: JSON.stringify({ count: 5 }),
      });
      setNewCodes(data.codes);
      load();
    } catch { /* ignore */ }
    setGenerating(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>邀请码</h2>
        <button onClick={generate} disabled={generating} style={btnStyle}>
          {generating ? '生成中...' : '生成 5 个邀请码'}
        </button>
      </div>

      {newCodes.length > 0 && (
        <div style={{ background: '#e8f5e9', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#2e7d32', marginBottom: 8 }}>新生成的邀请码：</div>
          {newCodes.map((code) => (
            <div key={code} style={{ fontFamily: 'monospace', fontSize: 16, padding: '4px 0' }}>{code}</div>
          ))}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>邀请码</th>
            <th style={thStyle}>状态</th>
            <th style={thStyle}>使用者</th>
            <th style={thStyle}>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}><code>{c.code}</code></td>
              <td style={tdStyle}>{c.usedBy ? <span style={{ color: '#999' }}>已使用</span> : <span style={{ color: '#2e7d32' }}>可用</span>}</td>
              <td style={tdStyle}>{c.usedBy || '-'}</td>
              <td style={tdStyle}>{new Date(c.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '6px 16px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
