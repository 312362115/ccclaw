import { useState, useRef, useEffect, useCallback } from 'react';
import { SendIcon, PaperClipIcon } from '../../components/icons';

interface Props {
  streaming: boolean;
  onSend: (content: string) => void;
}

export function ChatComposer({ streaming, onSend }: Props) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 自动调整高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  const clearInput = useCallback(() => {
    setInput('');
    // 强制清空 DOM 值，绕过 IME 残留
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    const content = trimmed;
    clearInput();
    // 延迟一帧发送，确保 React 先完成清空渲染
    requestAnimationFrame(() => onSend(content));
  }, [input, streaming, onSend, clearInput]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-5 py-3 pb-4 border-t border-line-soft">
      <div className="border border-line bg-white rounded-2xl px-3.5 pt-3 pb-2.5 transition-all duration-200 focus-within:border-blue-300 focus-within:shadow-[0_0_0_3px_rgba(59,130,246,0.1)]">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          className="w-full min-h-[52px] max-h-[160px] border-none resize-none outline-none bg-transparent text-text-primary leading-relaxed text-sm"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1">
            <button className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-text-muted hover:bg-slate-100 hover:text-text-primary transition-all duration-200">
              <PaperClipIcon className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="w-[34px] h-[34px] rounded-[10px] bg-accent text-white flex items-center justify-center transition-all duration-200 shadow-[0_2px_8px_rgba(37,99,235,0.2)] hover:bg-accent-ink hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            <SendIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
