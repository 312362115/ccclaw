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
  onSessionTitleChange?: (title: string) => void;
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
  onSessionTitleChange,
}: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [fileCollapsed, setFileCollapsed] = useState(false);
  const [sessionCollapsed, setSessionCollapsed] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [creating, setCreating] = useState<'file' | 'directory' | null>(null);
  const [createName, setCreateName] = useState('');

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

  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    api<Workspace[]>('/workspaces').then(setWorkspaces).catch(() => {});
  }, []);

  // 加载当前工作区的会话列表
  useEffect(() => {
    if (!currentWorkspace) { setSessions([]); return; }
    api<Array<{ id: string; title?: string; created_at: string }>>(`/workspaces/${currentWorkspace.id}/sessions`)
      .then((list) => {
        const mapped = list.map((s) => ({
          id: s.id,
          label: s.title || '默认会话',
          createdAt: s.created_at,
        }));
        setSessions(mapped.length > 0 ? mapped : [{ id: `session-${currentWorkspace.slug}`, label: '默认会话', createdAt: new Date().toISOString() }]);
      })
      .catch(() => {
        setSessions([{ id: `session-${currentWorkspace!.slug}`, label: '默认会话', createdAt: new Date().toISOString() }]);
      });
  }, [currentWorkspace]);

  // 当前 session 变化时通知标题
  useEffect(() => {
    if (!currentSessionId || !onSessionTitleChange) return;
    const session = sessions.find((s) => s.id === currentSessionId);
    onSessionTitleChange(session?.label || '新会话');
  }, [currentSessionId, sessions, onSessionTitleChange]);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');

  const handleNewSession = () => {
    if (!currentWorkspace) return;
    const sessionId = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newSession: Session = { id: sessionId, label: '新会话', createdAt: new Date().toISOString() };
    setSessions((prev) => [newSession, ...prev]);
    onSelectSession(currentWorkspace.id, sessionId);
    // 进入编辑名字状态
    setEditingSessionId(sessionId);
    setEditingSessionName('新会话');
  };

  const handleSessionRename = (sessionId: string) => {
    const trimmed = editingSessionName.trim();
    if (trimmed) {
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, label: trimmed } : s));
      // 持久化到后端
      if (currentWorkspace) {
        api(`/workspaces/${currentWorkspace.id}/sessions/${sessionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: trimmed }),
        }).catch(() => {});
      }
    }
    setEditingSessionId(null);
    setEditingSessionName('');
  };

  const handleArchiveSession = (sessionId: string) => {
    if (!currentWorkspace) return;
    api(`/workspaces/${currentWorkspace.id}/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    }).then(() => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      // 如果归档的是当前会话，切到第一个
      if (currentSessionId === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        if (remaining.length > 0) {
          onSelectSession(currentWorkspace.id, remaining[0].id);
        }
      }
    }).catch(() => {});
  };

  const handleCreateConfirm = useCallback(() => {
    const name = createName.trim();
    if (!name || !creating) return;
    onSendDirectMessage({
      channel: 'file',
      action: 'create',
      requestId: generateRequestId(),
      data: {
        path: name,
        type: creating,
        ...(creating === 'file' ? { content: '' } : {}),
      },
    });
    setCreating(null);
    setCreateName('');
  }, [createName, creating, onSendDirectMessage]);

  const handleMoveFile = useCallback(
    (oldPath: string, newPath: string) => {
      onSendDirectMessage({
        channel: 'file',
        action: 'rename',
        requestId: generateRequestId(),
        data: { oldPath, newPath },
      });
    },
    [onSendDirectMessage],
  );

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

  const [fileDeleteConfirm, setFileDeleteConfirm] = useState<{ path: string; type: 'file' | 'directory' } | null>(null);

  const handleDeleteClick = useCallback(
    (path: string, type: 'file' | 'directory') => {
      setFileDeleteConfirm({ path, type });
    },
    [],
  );

  const confirmFileDelete = useCallback(() => {
    if (!fileDeleteConfirm) return;
    onSendDirectMessage({
      channel: 'file',
      action: 'delete',
      requestId: generateRequestId(),
      data: { path: fileDeleteConfirm.path },
    });
    setFileDeleteConfirm(null);
  }, [fileDeleteConfirm, onSendDirectMessage]);

  const connLabel = connectionState === 'DIRECT' || connectionState === 'TUNNEL'
    ? '已连接'
    : connectionState === 'CONNECTING'
      ? '连接中...'
      : connectionState === 'DISCONNECTED'
        ? '未连接'
        : '';

  const connColor = connectionState === 'DIRECT' || connectionState === 'TUNNEL'
    ? 'bg-green-500'
    : connectionState === 'CONNECTING'
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
              <div className="flex items-center justify-between mt-2 px-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text-muted">{currentWorkspace.slug}</span>
                  <ModeBadge mode={currentWorkspace.settings?.startMode || 'local'} />
                </div>
                {connLabel && (
                  <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${connColor}`} />
                    <span className="text-[10px] text-text-soft">{connLabel}</span>
                  </div>
                )}
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
            <div className="flex items-center gap-2">
              {!fileCollapsed && (
                <div className="relative">
                  <button
                    onClick={() => setShowCreateMenu(!showCreateMenu)}
                    className="w-6 h-6 rounded-md inline-flex items-center justify-center text-text-muted transition-all duration-200 hover:bg-slate-100 hover:text-text-primary"
                    title="新建文件/目录"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                  </button>
                  {showCreateMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-line rounded-lg shadow-lg py-1 z-10 min-w-[100px]">
                      <button
                        onClick={() => { setCreating('file'); setShowCreateMenu(false); }}
                        className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 transition-colors"
                      >
                        新建文件
                      </button>
                      <button
                        onClick={() => { setCreating('directory'); setShowCreateMenu(false); }}
                        className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 transition-colors"
                      >
                        新建目录
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {!fileCollapsed && creating && (
            <div className="px-2 py-1.5 mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-soft shrink-0">
                  {creating === 'file' ? '文件:' : '目录:'}
                </span>
                <input
                  autoFocus
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateConfirm();
                    if (e.key === 'Escape') { setCreating(null); setCreateName(''); }
                  }}
                  onBlur={() => { setCreating(null); setCreateName(''); }}
                  placeholder={creating === 'file' ? 'src/main.ts' : 'src/utils'}
                  className="flex-1 text-xs border border-line rounded px-1.5 py-0.5 outline-none focus:border-blue-400 transition-colors min-w-0"
                />
              </div>
            </div>
          )}
          {!fileCollapsed && (
            <FileTree onFileClick={handleFileClick} onDeleteClick={handleDeleteClick} onMoveFile={handleMoveFile} />
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
            <div className="flex flex-col">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    if (editingSessionId !== s.id) {
                      currentWorkspace && onSelectSession(currentWorkspace.id, s.id);
                    }
                  }}
                  className={`group/session w-full rounded-md px-2.5 py-1 text-left transition-colors duration-200 hover:bg-slate-100 cursor-pointer ${
                    currentSessionId === s.id ? 'bg-accent-soft' : ''
                  }`}
                >
                  {editingSessionId === s.id ? (
                    <input
                      autoFocus
                      value={editingSessionName}
                      onChange={(e) => setEditingSessionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSessionRename(s.id);
                        if (e.key === 'Escape') { setEditingSessionId(null); setEditingSessionName(''); }
                      }}
                      onBlur={() => handleSessionRename(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-[11px] border border-line rounded px-1 py-0.5 outline-none focus:border-blue-400 bg-white"
                    />
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-text-primary truncate flex-1">{s.label}</span>
                      <span className="text-[9px] text-text-muted shrink-0 opacity-0 group-hover/session:opacity-100 transition-opacity">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                      <span
                        onClick={(e) => { e.stopPropagation(); handleArchiveSession(s.id); }}
                        className="text-[11px] text-slate-400 hover:text-red-500 opacity-0 group-hover/session:opacity-100 transition-opacity shrink-0 cursor-pointer px-0.5"
                        title="归档会话"
                      >
                        ✕
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="text-[11px] text-text-muted text-center py-2">请先选择工作区</div>
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

      {/* 文件/文件夹删除确认弹窗 */}
      {fileDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-[90%] shadow-lg">
            <h3 className="text-sm font-bold mb-2 text-red-600">确认删除</h3>
            <p className="text-[13px] mb-4">
              确定要删除{fileDeleteConfirm.type === 'directory' ? '目录' : '文件'}{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{fileDeleteConfirm.path}</code> 吗？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFileDeleteConfirm(null)}
                className="px-3 py-1.5 border border-line rounded-lg text-[13px] hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmFileDelete}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[13px] hover:bg-red-600 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
