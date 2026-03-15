import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Stats {
  workspaces: number;
  providers: number;
  skills: number;
  tokens: { input: number; output: number };
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>('/dashboard').then(setStats).catch(() => {});
  }, []);

  if (!stats) return <div>加载中...</div>;

  const cards = [
    { label: '工作区', value: stats.workspaces },
    { label: 'API Key', value: stats.providers },
    { label: '技能', value: stats.skills },
    { label: '输入 Token', value: stats.tokens.input.toLocaleString() },
    { label: '输出 Token', value: stats.tokens.output.toLocaleString() },
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>概览</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
        {cards.map((card) => (
          <div key={card.label} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1a73e8' }}>{card.value}</div>
            <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{card.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
