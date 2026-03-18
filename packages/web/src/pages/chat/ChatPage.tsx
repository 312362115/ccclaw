import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { connectWs, disconnectWs } from '../../api/ws';
import { useChatStore } from '../../stores/chat';
import { api } from '../../api/client';
import { WorkspacePanel } from '../../components/WorkspacePanel';
import { ChatMain } from './ChatMain';
import { FilePreviewPanel } from './FilePreviewPanel';
import { FilePanel } from '../../components/workspace/FilePanel';
import { useDirectConnection } from '../../hooks/useDirectConnection';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export function ChatPage() {
  const { workspaceId: urlWorkspaceId } = useParams<{ workspaceId: string }>();
  const [wsReady, setWsReady] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const initWsListener = useChatStore((s) => s.initWsListener);
  const loadMessages = useChatStore((s) => s.loadMessages);

  // Direct WebSocket connection to Runner for file operations
  const { sendDirectMessage } = useDirectConnection(currentWorkspace?.id ?? null);

  // WebSocket 连接
  useEffect(() => {
    connectWs()
      .then(() => setWsReady(true))
      .catch(() => { /* 重连由 ws.ts 处理 */ });

    const cleanup = initWsListener();

    return () => {
      cleanup();
      disconnectWs();
    };
  }, [initWsListener]);

  // 自动选择工作区：URL 指定 > localStorage 上次使用 > 唯一工作区自动选
  useEffect(() => {
    api<Workspace[]>('/workspaces').then((list) => {
      if (currentWorkspace) return;

      const lastId = localStorage.getItem('cc-last-workspace');
      const target = (lastId && list.find((w) => w.id === lastId)) || list[0];

      if (target) {
        setCurrentWorkspace(target);
        const sid = `session-${target.slug}`;
        setCurrentSessionId(sid);
        loadMessages(target.id, sid);
      }
    }).catch(() => {});
  }, [urlWorkspaceId]);

  const handleSelectWorkspace = (ws: Workspace) => {
    setCurrentWorkspace(ws);
    localStorage.setItem('cc-last-workspace', ws.id);
    const sessionId = `session-${ws.slug}`;
    setCurrentSessionId(sessionId);
    loadMessages(ws.id, sessionId);
  };

  const handleSelectSession = (workspaceId: string, sessionId: string) => {
    setCurrentSessionId(sessionId);
    loadMessages(workspaceId, sessionId);
  };

  const handleFileSelect = (name: string) => {
    setPreviewFile(name);
    setFilePreviewOpen(true);
  };

  const sessionTitle = currentWorkspace?.name || '新会话';

  return (
    <div className="flex h-full">
      {/* 工作区面板 */}
      <WorkspacePanel
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onFileSelect={handleFileSelect}
      />

      {/* 主区域 */}
      <div className="flex-1 min-w-0 flex">
        {currentWorkspace && currentSessionId && wsReady ? (
          <>
            <ChatMain
              workspaceId={currentWorkspace.id}
              sessionId={currentSessionId}
              sessionTitle={sessionTitle}
              terminalOpen={terminalOpen}
              filePreviewOpen={filePreviewOpen}
              onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
              onToggleFilePreview={() => setFilePreviewOpen(!filePreviewOpen)}
            />
            <FilePreviewPanel
              open={filePreviewOpen}
              fileName={previewFile}
              onClose={() => setFilePreviewOpen(false)}
            />
            {filePanelOpen && (
              <div className="w-72 shrink-0 border-l border-line-soft bg-white overflow-hidden">
                <FilePanel onSendDirectMessage={sendDirectMessage} />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="text-center text-text-muted">
              <div className="text-4xl mb-4 opacity-30">💬</div>
              <p className="text-lg font-medium">
                {wsReady ? '请选择一个工作区开始对话' : '正在连接...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
