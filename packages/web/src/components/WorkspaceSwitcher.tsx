import { useEffect, useRef } from 'react';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  workspaces: Workspace[];
  currentId: string | null;
  onSelect: (ws: Workspace) => void;
  onClose: () => void;
}

export function WorkspaceSwitcher({ workspaces, currentId, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

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
          <strong className="block text-[13px] text-text-primary">{ws.name}</strong>
          <span className="text-[11px] text-text-muted">{ws.slug}</span>
        </button>
      ))}
      {workspaces.length === 0 && (
        <div className="px-2 py-3 text-[12px] text-text-muted text-center">暂无工作区</div>
      )}
    </div>
  );
}
