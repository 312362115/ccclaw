import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chat';
import { MessageBubble } from './MessageBubble';

interface Props {
  workspaceId: string;
  sessionId: string;
}

export function ChatView({ workspaceId, sessionId }: Props) {
  const [input, setInput] = useState('');
  const messages = useChatStore((s) => s.getMessages(sessionId));
  const streaming = useChatStore((s) => s.streaming);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const send = useChatStore((s) => s.send);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    send(workspaceId, sessionId, trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 消息流 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} workspaceId={workspaceId} sessionId={sessionId} />
        ))}

        {/* 流式输出中 */}
        {streaming && streamBuffer && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div style={{
              maxWidth: '70%', padding: '8px 14px', borderRadius: 12,
              background: '#fff', border: '1px solid #e0e0e0',
              fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              {streamBuffer}
              <span style={{ animation: 'blink 1s infinite' }}>▊</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <div style={{ borderTop: '1px solid #e0e0e0', padding: 12, display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={2}
          style={{
            flex: 1, resize: 'none', padding: '8px 12px', border: '1px solid #ddd',
            borderRadius: 8, fontSize: 14, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          style={{
            padding: '8px 20px', background: streaming ? '#999' : '#1a73e8',
            color: '#fff', border: 'none', borderRadius: 8, cursor: streaming ? 'not-allowed' : 'pointer',
            fontSize: 14, alignSelf: 'flex-end',
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
