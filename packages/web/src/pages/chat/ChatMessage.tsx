import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatMessage as ChatMessageType } from '../../stores/chat';
import { useChatStore } from '../../stores/chat';

function formatToolInput(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <pre className="bg-slate-900 text-slate-200 rounded-lg p-3 my-2 overflow-x-auto text-xs leading-relaxed">{children}</pre>,
          code: ({ className, children, ...props }) => {
            const isBlock = className?.startsWith('language-');
            return isBlock
              ? <code className={className} {...props}>{children}</code>
              : <code className="bg-slate-100 text-pink-600 px-1 py-0.5 rounded text-[13px]" {...props}>{children}</code>;
          },
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-bold mb-1.5 mt-2.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2 first:mt-0">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="border-l-3 border-slate-300 pl-3 my-2 text-text-muted italic">{children}</blockquote>,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="border-collapse text-xs w-full">{children}</table></div>,
          th: ({ children }) => <th className="border border-slate-200 px-2 py-1 bg-slate-50 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-slate-200 px-2 py-1">{children}</td>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>,
          hr: () => <hr className="border-slate-200 my-3" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface Props {
  msg: ChatMessageType;
  workspaceId: string;
  sessionId: string;
}

export function ChatMessage({ msg, workspaceId, sessionId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);

  // ── System message ──
  if (msg.role === 'system') {
    return (
      <div className="self-center bg-success-soft text-emerald-700 border border-emerald-500/15 px-3.5 py-1.5 rounded-full text-xs font-medium">
        {msg.content}
      </div>
    );
  }

  // ── Thinking message ──
  if (msg.role === 'thinking') {
    return (
      <div className="max-w-[720px] animate-fade-in">
        <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 text-[13px] text-purple-800 italic leading-relaxed">
          <span className="mr-1.5">🧠</span>
          {msg.content}
        </div>
      </div>
    );
  }

  // ── Tool message ──
  if (msg.role === 'tool') {
    return (
      <div className="max-w-[720px] animate-fade-in">
        <div className="bg-slate-50 border border-line-soft rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-sm">🔧</span>
            <span className="font-semibold text-[13px]">{msg.toolName}</span>
            {msg.isStreaming && (
              <span className="text-xs text-accent font-medium animate-pulse-dot ml-1">● 执行中...</span>
            )}
          </div>

          {msg.toolInput && (
            <div className="mb-2">
              <button onClick={() => setExpanded(!expanded)}
                className="text-xs text-text-muted mb-1 flex items-center gap-1 hover:text-text-primary transition-colors">
                <span className="text-[10px]">{expanded ? '▼' : '▶'}</span> 参数
              </button>
              {expanded && (
                <pre className="bg-slate-900 text-slate-300 p-2.5 rounded-lg text-xs overflow-auto max-h-[200px] m-0 leading-relaxed">
                  {formatToolInput(msg.toolInput)}
                </pre>
              )}
            </div>
          )}

          {msg.toolOutput && (
            <div>
              <div className="text-xs text-emerald-600 mb-1 font-medium">✓ 结果</div>
              <pre className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-xs overflow-auto max-h-[300px] m-0 whitespace-pre-wrap break-words leading-relaxed">
                {msg.toolOutput.length > 2000
                  ? msg.toolOutput.slice(0, 2000) + '\n...(truncated)'
                  : msg.toolOutput}
              </pre>
            </div>
          )}

          {msg.confirmPending && (
            <div className="mt-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200">
              <div className="text-xs text-amber-800 mb-2 font-medium">⚠️ 需要确认: {msg.confirmReason}</div>
              <div className="flex gap-2">
                <button onClick={() => resolveConfirm(workspaceId, sessionId, msg.confirmRequestId!, true)}
                  className="px-3 py-1 bg-emerald-600 text-white rounded-md text-xs font-medium hover:bg-emerald-700 transition-colors">允许</button>
                <button onClick={() => resolveConfirm(workspaceId, sessionId, msg.confirmRequestId!, false)}
                  className="px-3 py-1 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700 transition-colors">拒绝</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── User / Assistant message ──
  const isUser = msg.role === 'user';

  return (
    <div className={`max-w-[720px] min-w-0 flex flex-col gap-1.5 animate-fade-in ${isUser ? 'self-end items-end' : 'items-start'}`}>
      <div className={`flex gap-2.5 items-end min-w-0 ${isUser ? 'flex-row-reverse' : ''}`}>
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 text-xs font-bold text-white"
          style={{
            background: isUser
              ? 'linear-gradient(135deg, #475569, #334155)'
              : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          }}
        >
          {isUser ? 'U' : 'AI'}
        </div>

        <div
          className={`rounded-2xl px-4 py-3.5 text-sm leading-[1.7] shadow-sm min-w-0 overflow-hidden ${
            isUser
              ? 'text-white border-transparent'
              : 'bg-slate-50 border border-line-soft'
          }`}
          style={isUser ? {
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            boxShadow: '0 4px 16px rgba(37, 99, 235, 0.2)',
          } : undefined}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap break-words">{msg.content}</span>
          ) : (
            <MarkdownContent content={msg.content} />
          )}
        </div>
      </div>

      <div className={`text-[11px] text-text-soft px-[42px] ${isUser ? 'text-right' : ''}`}>
        {new Date(msg.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
