import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from './icons';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { FileTree } from './FileTree';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface Session {
  id: string;
  label: string;
  createdAt: string;
}

interface Props {
  currentWorkspace: Workspace | null;
  onSelectWorkspace: (ws: Workspace) => void;
  currentSessionId: string | null;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onFileSelect?: (name: string) => void;
}

export function WorkspacePanel({
  currentWorkspace,
  onSelectWorkspace,
  currentSessionId,
  onSelectSession,
  onFileSelect,
}: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [fileCollapsed, setFileCollapsed] = useState(false);
  const [sessionCollapsed, setSessionCollapsed] = useState(false);

  // 用工作区的 slug 生成临时 session 列表（后续接 API）
  const sessions: Session[] = currentWorkspace
    ? [{ id: `session-${currentWorkspace.slug}`, label: '默认会话', createdAt: new Date().toISOString() }]
    : [];

  useEffect(() => {
    api<Workspace[]>('/workspaces').then(setWorkspaces).catch(() => {});
  }, []);

  const handleNewSession = () => {
    if (!currentWorkspace) return;
    const sessionId = `session-${currentWorkspace.slug}`;
    onSelectSession(currentWorkspace.id, sessionId);
  };

  return (
    <div className="w-[280px] min-w-[280px] flex flex-col bg-slate-50/90 backdrop-blur-xl border-r border-line-soft">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-line-soft">
        <div className="text-[10px] tracking-[0.1em] uppercase text-text-soft mb-0.5">WORKSPACE</div>
        <h2 className="text-[15px] font-bold text-text-primary">工作台</h2>
      </div>

      {/* 工作区选择器 */}
      <div className="px-4 py-3 border-b border-line-soft">
        <button
          onClick={() => setShowSwitcher(!showSwitcher)}
          className="w-full flex items-center justify-between bg-slate-50/90 border border-line rounded-[10px] px-3 h-9 text-[13px] font-semibold text-text-primary cursor-pointer transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="truncate">{currentWorkspace?.name || '选择工作区...'}</span>
          <ChevronDownIcon className="w-4 h-4 text-text-muted shrink-0" />
        </button>
      </div>

      {/* Switcher Popover */}
      {showSwitcher && (
        <WorkspaceSwitcher
          workspaces={workspaces}
          currentId={currentWorkspace?.id ?? null}
          onSelect={onSelectWorkspace}
          onClose={() => setShowSwitcher(false)}
        />
      )}

      {/* 文件区域 */}
      <div className={`p-2 flex flex-col overflow-hidden transition-all duration-250 ${fileCollapsed ? 'flex-none' : 'flex-1 min-h-0'}`}>
        <button
          onClick={() => setFileCollapsed(!fileCollapsed)}
          className="flex items-center gap-1.5 px-2 mb-1 group cursor-pointer"
        >
          <ChevronRightIcon className={`w-3 h-3 text-text-soft transition-transform duration-200 ${fileCollapsed ? '' : 'rotate-90'}`} />
          <span className="text-[11px] font-semibold text-text-soft uppercase tracking-wider group-hover:text-text-primary transition-colors">文件</span>
        </button>
        {!fileCollapsed && <FileTree onSelectFile={onFileSelect} />}
      </div>

      {/* 会话区域 */}
      <div className="p-2 pt-1 pb-1 border-t border-line-soft flex-none max-h-[200px] overflow-y-auto">
        <div className="flex items-center justify-between px-2 mb-1">
          <button
            onClick={() => setSessionCollapsed(!sessionCollapsed)}
            className="flex items-center gap-1.5 group cursor-pointer"
          >
            <ChevronRightIcon className={`w-3 h-3 text-text-soft transition-transform duration-200 ${sessionCollapsed ? '' : 'rotate-90'}`} />
            <span className="text-[11px] font-semibold text-text-soft uppercase tracking-wider group-hover:text-text-primary transition-colors">会话</span>
          </button>
          <button
            onClick={handleNewSession}
            className="w-6 h-6 rounded-md inline-flex items-center justify-center text-text-muted transition-all duration-200 hover:bg-slate-100 hover:text-text-primary"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        {!sessionCollapsed && (
          <div className="flex flex-col gap-0.5">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => currentWorkspace && onSelectSession(currentWorkspace.id, s.id)}
                className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-200 hover:bg-slate-100 ${
                  currentSessionId === s.id ? 'bg-accent-soft' : ''
                }`}
              >
                <strong className="block text-[13px] text-text-primary truncate">{s.label}</strong>
                <span className="text-[11px] text-text-muted">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="text-[12px] text-text-muted text-center py-3">请先选择工作区</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
