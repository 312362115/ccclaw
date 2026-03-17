import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Card } from '../../components/ui/Card';

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

  if (!stats) {
    return (
      <ContentPageShell>
        <div className="flex items-center justify-center flex-1 text-text-muted text-sm">加载中...</div>
      </ContentPageShell>
    );
  }

  const cards = [
    { label: '工作区', value: stats.workspaces },
    { label: 'API Key', value: stats.providers },
    { label: '技能', value: stats.skills },
    { label: '输入 Token', value: stats.tokens.input.toLocaleString() },
    { label: '输出 Token', value: stats.tokens.output.toLocaleString() },
  ];

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <h2 className="text-[22px] font-bold mb-1.5">概览</h2>
        <p className="text-text-muted text-sm">你的工作台概览</p>
      </div>
      <div className="px-7 py-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {cards.map((card) => (
            <Card key={card.label} label={card.label} value={card.value} accent />
          ))}
        </div>
      </div>
    </ContentPageShell>
  );
}
