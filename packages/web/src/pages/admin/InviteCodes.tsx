import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Button } from '../../components/ui/Button';

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
    <ContentPageShell>
      <div className="px-7 pt-7">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[22px] font-bold">邀请码</h2>
          <Button onClick={generate} disabled={generating}>
            {generating ? '生成中...' : '生成 5 个邀请码'}
          </Button>
        </div>
        <p className="text-text-muted text-sm">管理用户邀请码</p>
      </div>

      <div className="px-7 py-6">
        {newCodes.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl mb-5 animate-fade-in">
            <div className="text-[13px] text-emerald-700 font-medium mb-2">新生成的邀请码：</div>
            {newCodes.map((code) => (
              <div key={code} className="font-mono text-base py-0.5 text-emerald-900">{code}</div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                {['邀请码', '状态', '使用者', '创建时间'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 text-sm"><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{c.code}</code></td>
                  <td className="px-3 py-2.5 text-sm">
                    {c.usedBy
                      ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-text-muted">已使用</span>
                      : <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700">可用</span>}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{c.usedBy || '-'}</td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ContentPageShell>
  );
}
