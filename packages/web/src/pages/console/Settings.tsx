import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

export function Settings() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [codes, setCodes] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  const generateCodes = async () => {
    setGenerating(true);
    try {
      const data = await api<{ codes: string[] }>('/invite-codes', {
        method: 'POST',
        body: JSON.stringify({ count: 5 }),
      });
      setCodes(data.codes);
    } catch { /* ignore */ }
    setGenerating(false);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>设置</h2>

      <div style={{ marginBottom: 24 }}>
        <h3>个人信息</h3>
        <p style={{ fontSize: 14, color: '#666' }}>
          {user?.name} / {user?.email} / {user?.role === 'admin' ? '管理员' : '用户'}
        </p>
      </div>

      {isAdmin && (
        <div>
          <h3>邀请码</h3>
          <button onClick={generateCodes} disabled={generating} style={btnStyle}>
            {generating ? '生成中...' : '生成 5 个邀请码'}
          </button>
          {codes.length > 0 && (
            <div style={{ marginTop: 12, background: '#f9f9f9', padding: 12, borderRadius: 8 }}>
              {codes.map((code) => (
                <div key={code} style={{ fontFamily: 'monospace', fontSize: 16, padding: '4px 0' }}>{code}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '6px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 };
