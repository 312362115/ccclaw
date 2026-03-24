import { useState, useCallback } from 'react';
import { useFileTreeStore } from '../../stores/file-tree';
import { FileTree } from './FileTree';

function generateRequestId(): string {
  return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

interface FilePanelProps {
  onSendDirectMessage: (msg: any) => void;
}

type CreateType = 'file' | 'directory';

const CONNECTION_LABELS: Record<string, { text: string; color: string }> = {
  DIRECT: { text: '直连', color: 'bg-green-500' },
  RELAY: { text: '中转', color: 'bg-yellow-500' },
  DISCONNECTED: { text: '断开', color: 'bg-red-500' },
  CONNECTING: { text: '连接中', color: 'bg-yellow-500' },
  INIT: { text: '初始化', color: 'bg-gray-400' },
};

export function FilePanel({ onSendDirectMessage }: FilePanelProps) {
  const connectionState = useFileTreeStore((s) => s.connectionState);

  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [creating, setCreating] = useState<CreateType | null>(null);
  const [createName, setCreateName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; type: 'file' | 'directory' } | null>(null);

  const connInfo = CONNECTION_LABELS[connectionState] ?? CONNECTION_LABELS.INIT;

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
    (path: string, type: 'file' | 'directory') => {
      setDeleteConfirm({ path, type });
    },
    [],
  );

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

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm) return;
    onSendDirectMessage({
      channel: 'file',
      action: 'delete',
      requestId: generateRequestId(),
      data: { path: deleteConfirm.path },
    });
    setDeleteConfirm(null);
  }, [deleteConfirm, onSendDirectMessage]);

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

  const handleCreateCancel = useCallback(() => {
    setCreating(null);
    setCreateName('');
  }, []);


  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            className="text-xs font-medium text-text-primary bg-slate-100 hover:bg-slate-200 rounded-md px-2.5 py-1 transition-colors duration-200"
          >
            + 新建
          </button>
          {showCreateMenu && (
            <div className="absolute left-0 top-full mt-1 bg-white border border-line rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
              <button
                onClick={() => {
                  setCreating('file');
                  setShowCreateMenu(false);
                }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 transition-colors"
              >
                新建文件
              </button>
              <button
                onClick={() => {
                  setCreating('directory');
                  setShowCreateMenu(false);
                }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 transition-colors"
              >
                新建目录
              </button>
            </div>
          )}
        </div>

        {/* Connection state */}
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connInfo.color}`} />
          <span className="text-[11px] text-text-soft">{connInfo.text}</span>
        </div>
      </div>

      {/* Create input */}
      {creating && (
        <div className="px-3 py-2 border-b border-line-soft bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-soft shrink-0">
              {creating === 'file' ? '文件名:' : '目录名:'}
            </span>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateConfirm();
                if (e.key === 'Escape') handleCreateCancel();
              }}
              placeholder={creating === 'file' ? '例如 src/main.ts' : '例如 src/utils'}
              className="flex-1 text-xs border border-line rounded-md px-2 py-1 outline-none focus:border-blue-400 transition-colors"
            />
          </div>
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <FileTree onFileClick={handleFileClick} onDeleteClick={handleDeleteClick} onMoveFile={handleMoveFile} />
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-[90%] shadow-lg">
            <h3 className="text-base font-bold mb-3 text-danger">确认删除</h3>
            <p className="text-sm mb-4">
              确定要删除{deleteConfirm.type === 'directory' ? '目录' : '文件'}{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{deleteConfirm.path}</code>{' '}
              吗？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 border border-line rounded-lg bg-white text-sm hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg bg-danger text-white text-sm hover:bg-red-600 transition-colors"
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
