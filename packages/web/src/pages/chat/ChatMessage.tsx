import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatMessage as ChatMessageType, ToolCallInfo, ImageInfo } from '../../stores/chat';
import { useChatStore, extractToolSummary, toolIcon } from '../../stores/chat';

// ====== Markdown 渲染 ======

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

// ====== 工具调用行 — 极简日志行风格 ======

function ToolCallLine({ tc, messageId, sessionId }: { tc: ToolCallInfo; messageId: string; sessionId: string }) {
  const toggleExpanded = useChatStore((s) => s.toggleToolExpanded);
  const summary = extractToolSummary(tc.name, tc.input, tc.output);
  const icon = toolIcon(tc.name);

  const handleClick = () => {
    toggleExpanded(sessionId, messageId, tc.id);
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 cursor-pointer text-[12px] text-slate-400 hover:text-slate-500 select-none"
        onClick={handleClick}
      >
        <span className={`text-[10px] transition-transform ${tc.expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-[12px]">{icon}</span>
        <span>{tc.name}</span>
        {summary && <span className="text-slate-300 truncate flex-1">{summary}</span>}
        {tc.status === 'running' && <span className="text-blue-300 text-[10px] animate-pulse">●</span>}
        {tc.status === 'success' && <span className="text-green-300 text-[10px]">✓</span>}
        {tc.status === 'error' && <span className="text-red-400 text-[10px]">✗</span>}
      </div>

      {tc.expanded && (
        <div className="ml-5 mt-1 mb-1.5 text-xs rounded-md overflow-hidden border border-slate-100 bg-slate-50/50">
          <ToolDetailContent tc={tc} />
        </div>
      )}
    </div>
  );
}

function ToolDetailContent({ tc }: { tc: ToolCallInfo }) {
  const isEdit = tc.name === 'edit';
  const isBash = tc.name === 'bash' || tc.name === 'git';

  // Edit 工具: diff 视图
  if (isEdit && tc.output) {
    return (
      <div>
        <DiffView output={tc.output} />
        {tc.hookOutput && <HookBadge output={tc.hookOutput} />}
      </div>
    );
  }

  // Bash 工具: 终端风格
  if (isBash) {
    const cmd = tryParseField(tc.input, 'command') || '';
    return (
      <div>
        <pre className="bg-slate-900 text-slate-300 p-2.5 text-[11px] leading-relaxed overflow-auto max-h-[300px] whitespace-pre-wrap break-words">
          <span className="text-slate-500">$ </span>{cmd}
          {tc.output && <>{'\n'}{truncate(tc.output, 3000)}</>}
        </pre>
        {tc.hookOutput && <HookBadge output={tc.hookOutput} />}
      </div>
    );
  }

  // 其他工具: 纯文本输出
  return (
    <div>
      {tc.output && (
        <pre className="p-2.5 text-[11px] text-slate-600 leading-relaxed overflow-auto max-h-[300px] whitespace-pre-wrap break-words">
          {truncate(tc.output, 3000)}
        </pre>
      )}
      {tc.hookOutput && <HookBadge output={tc.hookOutput} />}
    </div>
  );
}

function DiffView({ output }: { output: string }) {
  // 简化 diff：查找 old_string/new_string 或直接显示输出
  const lines = output.split('\n');
  return (
    <div className="text-[11px] font-mono leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('- ') || line.startsWith('-\t')) {
          return <div key={i} className="bg-red-50 text-red-800 px-2 py-px">{line}</div>;
        }
        if (line.startsWith('+ ') || line.startsWith('+\t')) {
          return <div key={i} className="bg-green-50 text-green-800 px-2 py-px">{line}</div>;
        }
        return <div key={i} className="text-slate-500 px-2 py-px">{line}</div>;
      })}
    </div>
  );
}

function HookBadge({ output }: { output: string }) {
  return (
    <div className="px-2.5 py-1.5 bg-amber-50 border-t border-amber-100 text-[11px] text-amber-700">
      <span className="font-semibold mr-1">🪝 Hook:</span>{output}
    </div>
  );
}

// ====== Confirm 请求 ======

function ConfirmBlock({ msg, workspaceId, sessionId }: { msg: ChatMessageType; workspaceId: string; sessionId: string }) {
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);

  if (!msg.confirmPending && msg.content) {
    // 已处理
    return (
      <div className="self-center text-xs text-slate-400 py-1">
        {msg.content}
      </div>
    );
  }

  return (
    <div className="max-w-[720px] animate-fade-in">
      <div className="border border-amber-200 rounded-xl overflow-hidden bg-amber-50/50">
        <div className="px-3 py-2 text-[13px] font-semibold text-amber-800 flex items-center gap-1.5">
          ⚠️ 需要确认 — {msg.confirmTool}
        </div>
        <div className="px-3 py-2 border-t border-amber-100 font-mono text-[12px] text-amber-900 bg-amber-50">
          <pre className="whitespace-pre-wrap">{msg.confirmInput}</pre>
          {msg.confirmReason && (
            <div className="mt-1.5 text-[11px] text-amber-700">{msg.confirmReason}</div>
          )}
        </div>
        <div className="px-3 py-2 border-t border-amber-100 flex gap-2">
          <button
            onClick={() => resolveConfirm(workspaceId, sessionId, msg.confirmRequestId!, true)}
            className="px-3 py-1 bg-emerald-600 text-white rounded-md text-xs font-medium hover:bg-emerald-700"
          >✓ 允许</button>
          <button
            onClick={() => resolveConfirm(workspaceId, sessionId, msg.confirmRequestId!, false)}
            className="px-3 py-1 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700"
          >✗ 拒绝</button>
        </div>
      </div>
    </div>
  );
}

// ====== 图片渲染 ======

function MessageImages({ images }: { images: ImageInfo[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {images.map((img, i) => (
        <img
          key={i}
          src={`data:${img.mediaType};base64,${img.data}`}
          alt=""
          className="max-w-[300px] max-h-[200px] rounded-lg border border-slate-200 object-cover"
        />
      ))}
    </div>
  );
}

// ====== Plan 模式内容 ======

function PlanContent({ content }: { content: string }) {
  return (
    <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
      <MarkdownContent content={content} />
    </div>
  );
}

// ====== 主组件 ======

interface Props {
  msg: ChatMessageType;
  workspaceId: string;
  sessionId: string;
}

export function ChatMessage({ msg, workspaceId, sessionId }: Props) {
  // ── Confirm 消息（独立渲染）──
  if (msg.confirmRequestId) {
    return <ConfirmBlock msg={msg} workspaceId={workspaceId} sessionId={sessionId} />;
  }

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

  // ── User / Assistant message ──
  const isUser = msg.role === 'user';
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
  const hasImages = msg.images && msg.images.length > 0;

  return (
    <div className={`max-w-[720px] min-w-0 flex flex-col gap-1.5 animate-fade-in ${isUser ? 'self-end items-end' : 'items-start'}`}>
      <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse items-end' : 'items-start'} min-w-0`}>
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 text-xs font-bold text-white mt-0.5"
          style={{
            background: isUser
              ? 'linear-gradient(135deg, #475569, #334155)'
              : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          }}
        >
          {isUser ? 'U' : 'AI'}
        </div>

        <div className="min-w-0 flex-1 flex flex-col gap-1">
          {/* 工具调用行（AI 消息，显示在文字前面） */}
          {!isUser && hasToolCalls && (
            <div className="pl-0.5">
              {msg.toolCalls!.map((tc) => (
                <ToolCallLine key={tc.id} tc={tc} messageId={msg.id} sessionId={sessionId} />
              ))}
            </div>
          )}

          {/* 消息内容 */}
          {msg.content && (
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
              ) : msg.planMode ? (
                <PlanContent content={msg.content} />
              ) : (
                <MarkdownContent content={msg.content} />
              )}
            </div>
          )}

          {/* 图片 */}
          {hasImages && <MessageImages images={msg.images!} />}
        </div>
      </div>

      <div className={`text-[11px] text-text-soft px-[42px] ${isUser ? 'text-right' : ''}`}>
        {new Date(msg.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

// ====== Utils ======

function tryParseField(json: string, field: string): string {
  try { return (JSON.parse(json) as Record<string, any>)[field] ?? ''; }
  catch { return ''; }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n...(truncated)' : s;
}
