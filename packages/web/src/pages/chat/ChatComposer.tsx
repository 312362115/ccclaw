import { useState, useRef, useEffect, useCallback } from 'react';
import { SendIcon, PaperClipIcon } from '../../components/icons';
import { useChatStore, type ImageInfo } from '../../stores/chat';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB per image
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

interface Props {
  streaming: boolean;
  sessionId: string;
  onSend: (content: string) => void;
}

export function ChatComposer({ streaming, sessionId, onSend }: Props) {
  const [input, setInput] = useState('');
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

  const pendingImages = useChatStore((s) => s.getPendingImages(sessionId));
  const addPendingImage = useChatStore((s) => s.addPendingImage);
  const removePendingImage = useChatStore((s) => s.removePendingImage);
  const sendWithImages = useChatStore((s) => s.sendWithImages);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  const clearInput = useCallback(() => {
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
  }, []);

  // 处理图片文件
  const processImageFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return;
    if (file.size > MAX_IMAGE_SIZE) {
      alert(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大 5MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]; // strip data:...;base64, prefix
      addPendingImage(sessionId, { data: base64, mediaType: file.type });
    };
    reader.readAsDataURL(file);
  }, [sessionId, addPendingImage]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && pendingImages.length === 0) || streaming) return;
    const content = trimmed;
    clearInput();
    requestAnimationFrame(() => {
      if (pendingImages.length > 0) {
        sendWithImages(
          '', // workspaceId from parent context — direct channel uses sessionId
          sessionId,
          content,
          pendingImages,
        );
      } else {
        onSend(content);
      }
    });
  }, [input, streaming, pendingImages, sessionId, onSend, clearInput, sendWithImages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault();
      handleSend();
    }
  };

  // 粘贴图片
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processImageFile(file);
        return;
      }
    }
  };

  // 拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = () => setDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith('image/')) processImageFile(file);
    }
  };

  // 文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    for (const file of e.target.files) {
      processImageFile(file);
    }
    e.target.value = ''; // 重置，允许重复选同一文件
  };

  return (
    <div className="px-5 py-3 pb-4 border-t border-line-soft">
      <div
        className={`relative border bg-white rounded-2xl px-3.5 pt-3 pb-2.5 transition-all duration-200 focus-within:border-blue-300 focus-within:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] ${
          dragging ? 'border-blue-400 bg-blue-50/30' : 'border-line'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 拖拽覆盖层 */}
        {dragging && (
          <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/50 flex items-center justify-center z-10 pointer-events-none">
            <span className="text-blue-500 text-sm font-medium">松开以添加图片</span>
          </div>
        )}

        {/* 图片预览行 */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-200 shrink-0">
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => removePendingImage(sessionId, i)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white border-2 border-white rounded-full text-[9px] flex items-center justify-center leading-none hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          className="w-full min-h-[52px] max-h-[160px] border-none resize-none outline-none bg-transparent text-text-primary leading-relaxed text-sm"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-blue-500 hover:bg-blue-50 hover:text-blue-600 transition-all duration-200"
              title="上传图片"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <button className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-text-muted hover:bg-slate-100 hover:text-text-primary transition-all duration-200">
              <PaperClipIcon className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={streaming || (!input.trim() && pendingImages.length === 0)}
            className="w-[34px] h-[34px] rounded-[10px] bg-accent text-white flex items-center justify-center transition-all duration-200 shadow-[0_2px_8px_rgba(37,99,235,0.2)] hover:bg-accent-ink hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            <SendIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
