import { useState, useEffect } from 'react';
import { SessionList } from './SessionList';
import { ChatView } from './ChatView';
import { connectWs, disconnectWs } from '../../api/ws';
import { useChatStore } from '../../stores/chat';

export function ChatLayout() {
  const [selected, setSelected] = useState<{ workspaceId: string; sessionId: string } | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const initWsListener = useChatStore((s) => s.initWsListener);

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

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
      <SessionList
        onSelect={(workspaceId, sessionId) => setSelected({ workspaceId, sessionId })}
      />
      <div style={{ flex: 1 }}>
        {selected && wsReady ? (
          <ChatView workspaceId={selected.workspaceId} sessionId={selected.sessionId} />
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999' }}>
            {wsReady ? '请选择一个工作区开始对话' : '正在连接...'}
          </div>
        )}
      </div>
    </div>
  );
}
