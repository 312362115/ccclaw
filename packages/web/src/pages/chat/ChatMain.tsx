import { useRef, useEffect } from 'react';
import { useChatStore, EMPTY_MESSAGES } from '../../stores/chat';
import { ChatHeader } from './ChatHeader';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';
import { TerminalPanel } from './TerminalPanel';

interface Props {
  workspaceId: string;
  sessionId: string;
  sessionTitle: string;
  terminalOpen: boolean;
  filePreviewOpen: boolean;
  onToggleTerminal: () => void;
  onToggleFilePreview: () => void;
  onSessionTitleChange?: (title: string) => void;
}

export function ChatMain({
  workspaceId,
  sessionId,
  sessionTitle,
  terminalOpen,
  filePreviewOpen,
  onToggleTerminal,
  onToggleFilePreview,
  onSessionTitleChange,
}: Props) {
  const messages = useChatStore((s) => s.messages.get(sessionId) || EMPTY_MESSAGES);
  const streaming = useChatStore((s) => s.isStreaming(sessionId));
  const streamBuffer = useChatStore((s) => s.getStreamBuffer(sessionId));
  const streamError = useChatStore((s) => s.getStreamError(sessionId));
  const planMode = useChatStore((s) => s.isPlanMode(sessionId));
  const send = useChatStore((s) => s.send);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  const aiStatus: 'idle' | 'thinking' | 'typing' = !streaming
    ? 'idle'
    : streamBuffer
      ? 'typing'
      : 'thinking';

  const handleSend = (content: string) => {
    send(workspaceId, sessionId, content);
  };

  const handleExecutePlan = () => {
    send(workspaceId, sessionId, '执行计划');
  };

  const handleReplan = () => {
    send(workspaceId, sessionId, '重新规划');
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
      <ChatHeader
        title={sessionTitle}
        aiStatus={aiStatus}
        planMode={planMode}
        terminalOpen={terminalOpen}
        filePreviewOpen={filePreviewOpen}
        onToggleTerminal={onToggleTerminal}
        onToggleFilePreview={onToggleFilePreview}
        onTitleChange={onSessionTitleChange}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto px-6 pt-5 pb-4 flex flex-col gap-4">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              workspaceId={workspaceId}
              sessionId={sessionId}
            />
          ))}

          {/* AI 响应气泡：thinking → streaming → error */}
          {(streaming || streamError) && (
            <div className="max-w-[720px] min-w-0 flex gap-2.5 items-start animate-fade-in">
              <div
                className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 text-xs font-bold text-white mt-0.5"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}
              >
                AI
              </div>
              {streamError ? (
                <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm shadow-sm min-w-0 overflow-hidden">
                  <span className="text-red-600 text-[13px]">{streamError}</span>
                </div>
              ) : streamBuffer ? (
                <div className="bg-slate-50 border border-line-soft rounded-2xl px-4 py-3.5 text-sm leading-[1.7] shadow-sm min-w-0 overflow-hidden">
                  <span className="whitespace-pre-wrap break-words">{streamBuffer}</span>
                  <span className="inline-block w-1.5 h-4 bg-accent rounded-sm align-text-bottom ml-0.5 animate-blink" />
                </div>
              ) : (
                <div className="bg-slate-50 border border-line-soft rounded-2xl px-4 py-4 shadow-sm">
                  <span className="inline-flex items-center gap-[5px]">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="w-[6px] h-[6px] rounded-full bg-slate-400"
                        style={{ animation: 'bounce-dot 1.2s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Plan 模式执行按钮（非 streaming 且有 plan 内容时显示） */}
          {planMode && !streaming && messages.length > 0 && messages[messages.length - 1]?.planMode && (
            <div className="flex gap-2 pl-[42px]">
              <button
                onClick={handleExecutePlan}
                className="px-4 py-1.5 bg-accent text-white rounded-lg text-[13px] font-medium hover:bg-blue-700 transition-colors"
              >
                ▶ 执行计划
              </button>
              <button
                onClick={handleReplan}
                className="px-4 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium hover:bg-slate-200 transition-colors"
              >
                重新规划
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <ChatComposer streaming={streaming} sessionId={sessionId} onSend={handleSend} />
      </div>

      <TerminalPanel
        workspaceId={workspaceId}
        open={terminalOpen}
        onClose={onToggleTerminal}
      />
    </div>
  );
}
