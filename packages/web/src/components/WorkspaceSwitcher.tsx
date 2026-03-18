import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { PlusIcon } from './icons';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  settings?: { startMode?: 'local' | 'docker' | 'remote'; [key: string]: unknown };
}

const MODE_LABELS: Record<string, string> = { local: 'Local', docker: 'Docker', remote: 'Remote' };
const MODE_COLORS: Record<string, string> = { local: 'bg-emerald-100 text-emerald-700', docker: 'bg-blue-100 text-blue-700', remote: 'bg-purple-100 text-purple-700' };

interface Props {
  workspaces: Workspace[];
  currentId: string | null;
  onSelect: (ws: Workspace) => void;
  onClose: () => void;
}

export function WorkspaceSwitcher({ workspaces, currentId, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'local' | 'docker' | 'remote'>('local');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      const ws = await api<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, settings: { startMode: mode } }),
      });
      onSelect(ws);
      onClose();
    } catch (err: any) {
      setError(err?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute left-[80px] top-[88px] w-[230px] bg-white/98 border border-line rounded-2xl shadow-lg p-2 z-50 animate-fade-in"
    >
      <div className="px-2 pb-2 text-[11px] tracking-wider uppercase text-text-soft">
        切换工作区
      </div>
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          onClick={() => { onSelect(ws); onClose(); }}
          className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-200 hover:bg-slate-100 ${
            currentId === ws.id ? 'bg-accent-soft' : ''
          }`}
        >
          <div className="flex items-center gap-1.5">
            <strong className="text-[13px] text-text-primary truncate">{ws.name}</strong>
            {(() => {
              const m = ws.settings?.startMode || 'local';
              return <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${MODE_COLORS[m] || ''}`}>{MODE_LABELS[m] || m}</span>;
            })()}
          </div>
          <span className="text-[11px] text-text-muted">{ws.slug}</span>
        </button>
      ))}
      {workspaces.length === 0 && (
        <div className="px-2 py-3 text-[12px] text-text-muted text-center">暂无工作区</div>
      )}

      {/* 分割线 + 新建 */}
      <div className="border-t border-line-soft mt-1 pt-1">
        {creating ? (
          <div className="px-2 py-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setCreating(false); setName(''); setMode('local'); setError(''); }
              }}
              placeholder="工作区名称"
              className="w-full h-8 border border-line rounded-lg px-2.5 text-[13px] outline-none focus:border-blue-400 transition-colors mb-2"
            />
            <div className="flex gap-1 mb-2">
              {(['local', 'docker', 'remote'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 h-7 rounded-md text-[11px] font-medium transition-colors ${
                    mode === m
                      ? MODE_COLORS[m]
                      : 'bg-slate-50 text-text-muted hover:bg-slate-100'
                  }`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            {error && <div className="text-[11px] text-red-500 mb-1.5">{error}</div>}
            <div className="flex gap-1.5">
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="flex-1 h-7 bg-blue-500 text-white text-[12px] font-medium rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {saving ? '创建中...' : '创建'}
              </button>
              <button
                onClick={() => { setCreating(false); setName(''); setMode('local'); setError(''); }}
                className="h-7 px-3 text-[12px] border border-line rounded-md hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full rounded-lg px-2.5 py-2 text-left flex items-center gap-2 text-text-muted hover:bg-slate-100 hover:text-text-primary transition-colors duration-200"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            <span className="text-[13px]">新建工作区</span>
          </button>
        )}
      </div>
    </div>
  );
}
