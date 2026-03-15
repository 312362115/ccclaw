import { useState } from 'react';
import type { ChatMessage } from '../../stores/chat';

export function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '70%',
        padding: '8px 14px',
        borderRadius: 12,
        background: isUser ? '#1a73e8' : isTool ? '#f0f0f0' : '#fff',
        color: isUser ? '#fff' : '#333',
        border: isUser ? 'none' : '1px solid #e0e0e0',
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {isTool && (
          <div
            style={{ cursor: 'pointer', fontWeight: 500, color: '#666' }}
            onClick={() => setExpanded(!expanded)}
          >
            {msg.content} {expanded ? '▼' : '▶'}
          </div>
        )}

        {isTool && expanded && msg.toolInput != null && (
          <pre style={{ marginTop: 4, fontSize: 12, background: '#e8e8e8', padding: 8, borderRadius: 4, overflow: 'auto' }}>
            {String(JSON.stringify(msg.toolInput, null, 2))}
          </pre>
        )}

        {!isTool && msg.content}
      </div>
    </div>
  );
}
