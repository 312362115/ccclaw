import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from './icons';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { FileTree } from './workspace/FileTree';
import { useFileTreeStore } from '../stores/file-tree';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  settings?: { startMode?: 'local' | 'docker' | 'remote'; [key: string]: unknown };
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
  onSendDirectMessage: (msg: any) => void;
}

function generateRequestId(): string {
  return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

type StartMode = 'local' | 'docker' | 'remote';

const MODE_CONFIG: Record<StartMode, { label: string; color: string }> = {
  local:  { label: 'Local',  color: 'bg-emerald-100 text-emerald-700' },
  docker: { label: 'Docker', color: 'bg-blue-100 text-blue-700' },
  remote: { label: 'Remote', color: 'bg-purple-100 text-purple-700' },
};

function ModeBadge({ mode }: { mode: StartMode }) {
  const cfg = MODE_CONFIG[mode];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function RemoteHint({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  // 用当前页面的 origin 拼出 API 地址，开发模式下 API 走 proxy 到 3000
  const apiBase = window.location.port === '5174'
    ? `http://${window.location.hostname}:3000`
    : window.location.origin;
  const secret = '<RUNNER_SECRET>';
  const cmd = `curl -fsSL '${apiBase}/api/runner-bootstrap?slug=${slug}&token=${secret}' | bash`;

  const handleCopy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-2 bg-slate-100 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-text-soft uppercase tracking-wide">一键启动</span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-blue-500 hover:text-blue-600 transition-colors"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <p className="text-[10px] text-text-muted mb-1.5">在远端机器执行以下命令：</p>
      <pre className="text-[10px] text-slate-600 font-mono leading-relaxed whitespace-pre-wrap break-all select-all bg-white rounded px-2 py-1.5 border border-line-soft">
        {cmd}
      </pre>
      <p className="text-[9px] text-text-soft mt-1.5">将 &lt;RUNNER_SECRET&gt; 替换为 .env 中的 RUNNER_SECRET 值</p>
    </div>
  );
}

const PANEL_MIN = 220;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 280;
const STORAGE_KEY = 'cc-workspace-panel-width';

export function WorkspacePanel({
  currentWorkspace,
  onSelectWorkspace,
  currentSessionId,
  onSelectSession,
  onSendDirectMessage,
}: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [fileCollapsed, setFileCollapsed] = useState(false);
  const [sessionCollapsed, setSessionCollapsed] = useState(false);

  // 可调宽度
  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) : PANEL_DEFAULT;
  });
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const currentW = useRef(width);

  useEffect(() => { currentW.current = width; }, [width]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    startX.current = e.clientX;
    startW.current = currentW.current;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX.current;
      setWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW.current + delta)));
    };
    const onUp = () => {
      setDragging(false);
      localStorage.setItem(STORAGE_KEY, String(currentW.current));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const connectionState = useFileTreeStore((s) => s.connectionState);

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

  const handleFileClick = useCallback(
    (path: string) => {
      onSendDirectMessage({
        channel: 'file',
        action: 'read',
        requestId: generateRequestId(),
        data: { path },
      });
    },
    [onSendDirectMessage],
  );

  const handleDeleteClick = useCallback(
    (path: string, _type: 'file' | 'directory') => {
      onSendDirectMessage({
        channel: 'file',
        action: 'delete',
        requestId: generateRequestId(),
        data: { path },
      });
    },
    [onSendDirectMessage],
  );

  const connLabel = connectionState === 'DIRECT' || connectionState === 'TUNNEL'
    ? '已连接'
    : connectionState === 'CONNECTING' || connectionState === 'TUNNEL_CONNECTING'
      ? '连接中...'
      : connectionState === 'DISCONNECTED'
        ? '未连接'
        : '';

  const connColor = connectionState === 'DIRECT' || connectionState === 'TUNNEL'
    ? 'bg-green-500'
    : connectionState === 'CONNECTING' || connectionState === 'TUNNEL_CONNECTING'
      ? 'bg-yellow-500'
      : connectionState === 'DISCONNECTED'
        ? 'bg-red-500'
        : 'bg-gray-400';

  return (
    <div className="flex shrink-0" style={{ width: `${width}px` }}>
      <div className="flex-1 min-w-0 flex flex-col bg-slate-50/90 backdrop-blur-xl border-r border-line-soft">
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
          {currentWorkspace && (
            <>
              <div className="flex items-center gap-2 mt-2 px-0.5">
                <span className="text-[11px] text-text-muted">{currentWorkspace.slug}</span>
                <ModeBadge mode={currentWorkspace.settings?.startMode || 'local'} />
              </div>
              {currentWorkspace.settings?.startMode === 'remote' && (
                <RemoteHint slug={currentWorkspace.slug} />
              )}
            </>
          )}
        </div>

        {/* Switcher Popover */}
        {showSwitcher && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentId={currentWorkspace?.id ?? null}
            onSelect={(ws) => {
              onSelectWorkspace(ws);
              // 刷新列表（新建后需要）
              api<Workspace[]>('/workspaces').then(setWorkspaces).catch(() => {});
            }}
            onClose={() => setShowSwitcher(false)}
          />
        )}

        {/* 文件区域 */}
        <div className={`p-2 flex flex-col overflow-hidden transition-all duration-250 ${fileCollapsed ? 'flex-none' : 'flex-1 min-h-0'}`}>
          <div className="flex items-center justify-between px-2 mb-1">
            <button
              onClick={() => setFileCollapsed(!fileCollapsed)}
              className="flex items-center gap-1.5 group cursor-pointer"
            >
              <ChevronRightIcon className={`w-3 h-3 text-text-soft transition-transform duration-200 ${fileCollapsed ? '' : 'rotate-90'}`} />
              <span className="text-[11px] font-semibold text-text-soft uppercase tracking-wider group-hover:text-text-primary transition-colors">文件</span>
            </button>
            {connLabel && (
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${connColor}`} />
                <span className="text-[10px] text-text-soft">{connLabel}</span>
              </div>
            )}
          </div>
          {!fileCollapsed && (
            <FileTree onFileClick={handleFileClick} onDeleteClick={handleDeleteClick} />
          )}
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

      {/* 右侧拖拽手柄 */}
      <div
        onMouseDown={onResizeStart}
        className="w-2 shrink-0 cursor-col-resize flex items-center justify-center select-none hover:bg-accent/10 transition-colors"
      >
        <div className={`w-[3px] rounded-full transition-all duration-200 ${dragging ? 'h-12 bg-accent' : 'h-8 bg-slate-300 hover:bg-accent hover:h-12'}`} />
      </div>
    </div>
  );
}
