import { useState } from 'react';
import type { ChatMessage } from '../../stores/chat';
import { useChatStore } from '../../stores/chat';

function formatToolInput(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

interface MessageBubbleProps {
  msg: ChatMessage;
  workspaceId: string;
  sessionId: string;
}

export function MessageBubble({ msg, workspaceId, sessionId }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);

  // ── System message (consolidation, sub-agent events, etc.) ────────────────
  if (msg.role === 'system') {
    return (
      <div style={{
        textAlign: 'center',
        padding: '4px 12px',
        fontSize: 12,
        color: '#999',
        marginBottom: 8,
      }}>
        {msg.content}
      </div>
    );
  }

  // ── Thinking message ──────────────────────────────────────────────────────
  if (msg.role === 'thinking') {
    return (
      <div style={{
        background: '#f3e8fd',
        border: '1px solid #e1bee7',
        borderRadius: 8,
        padding: '8px 12px',
        maxWidth: '80%',
        marginBottom: 8,
        fontSize: 13,
        color: '#7b1fa2',
        fontStyle: 'italic',
      }}>
        <span style={{ marginRight: 6 }}>🧠</span>
        {msg.content}
      </div>
    );
  }

  // ── Tool message ──────────────────────────────────────────────────────────
  if (msg.role === 'tool') {
    return (
      <div style={{
        background: '#f8f9fa',
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        padding: 12,
        maxWidth: '80%',
        marginBottom: 8,
      }}>
        {/* Header: tool name + streaming indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>🔧</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{msg.toolName}</span>
          {msg.isStreaming && (
            <span style={{ fontSize: 12, color: '#1a73e8', animation: 'pulse 1s infinite' }}>
              ● 执行中...
            </span>
          )}
        </div>

        {/* Tool Input — expandable, shows streaming */}
        {msg.toolInput && (
          <div style={{ marginBottom: 8 }}>
            <div
              onClick={() => setExpanded(!expanded)}
              style={{ cursor: 'pointer', fontSize: 12, color: '#666', marginBottom: 4 }}
            >
              {expanded ? '▼' : '▶'} 参数
            </div>
            {expanded && (
              <pre style={{
                background: '#1e1e1e',
                color: '#d4d4d4',
                padding: 10,
                borderRadius: 6,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 200,
                margin: 0,
              }}>
                {formatToolInput(msg.toolInput)}
              </pre>
            )}
          </div>
        )}

        {/* Tool Output/Result */}
        {msg.toolOutput && (
          <div>
            <div style={{ fontSize: 12, color: '#137333', marginBottom: 4 }}>✓ 结果</div>
            <pre style={{
              background: '#f0faf0',
              border: '1px solid #c8e6c9',
              padding: 10,
              borderRadius: 6,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 300,
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.toolOutput.length > 2000
                ? msg.toolOutput.slice(0, 2000) + '\n...(truncated)'
                : msg.toolOutput}
            </pre>
          </div>
        )}

        {/* Confirm Request */}
        {msg.confirmPending && (
          <div style={{
            marginTop: 8,
            padding: 8,
            background: '#fff3e0',
            borderRadius: 6,
            border: '1px solid #ffe0b2',
          }}>
            <div style={{ fontSize: 12, color: '#e65100', marginBottom: 4 }}>
              ⚠️ 需要确认: {msg.confirmReason}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => resolveConfirm(workspaceId, sessionId, msg.confirmRequestId!, true)}
                style={{ padding: '4px 12px', background: '#137333', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                允许
              </button>
              <button
                onClick={() => resolveConfirm(workspaceId, sessionId, msg.confirmRequestId!, false)}
                style={{ padding: '4px 12px', background: '#c5221f', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                拒绝
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── User / Assistant message ──────────────────────────────────────────────
  const isUser = msg.role === 'user';

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
        background: isUser ? '#1a73e8' : '#fff',
        color: isUser ? '#fff' : '#333',
        border: isUser ? 'none' : '1px solid #e0e0e0',
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  );
}
