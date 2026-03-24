import { useEffect, useRef, useCallback } from 'react';
import { useResizable } from '../../hooks/useResizable';
import { CloseIcon } from '../../components/icons';
import { useFileTreeStore } from '../../stores/file-tree';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

function generateRequestId(): string {
  return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function getLanguageExtension(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js': case 'jsx':
      return javascript({ jsx: true });
    case 'ts': case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'html': case 'htm':
      return html();
    case 'css': case 'scss': case 'less':
      return css();
    case 'json':
      return json();
    case 'md': case 'markdown':
      return markdown();
    case 'py':
      return python();
    default:
      return null;
  }
}

interface Props {
  onSendDirectMessage: (msg: any) => void;
}

export function FilePreviewPanel({ onSendDirectMessage }: Props) {
  const previewPath = useFileTreeStore((s) => s.previewPath);
  const previewContent = useFileTreeStore((s) => s.previewContent);
  const previewBinary = useFileTreeStore((s) => s.previewBinary);
  const previewLoading = useFileTreeStore((s) => s.previewLoading);
  const previewChanged = useFileTreeStore((s) => s.previewChanged);
  const previewSaving = useFileTreeStore((s) => s.previewSaving);
  const previewSaveError = useFileTreeStore((s) => s.previewSaveError);
  const setPreview = useFileTreeStore((s) => s.setPreview);
  const setPreviewSaving = useFileTreeStore((s) => s.setPreviewSaving);

  const open = previewPath !== null;

  const { size, dragging, onMouseDown } = useResizable({
    storageKey: 'cc-preview-width',
    defaultSize: 480,
    minSize: 320,
    maxSize: 900,
    direction: 'horizontal',
  });

  const handleClose = () => setPreview(null, null, false);

  const fileName = previewPath?.split('/').pop() ?? null;

  // ── CodeMirror 编辑器 ──
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSendRef = useRef(onSendDirectMessage);
  const pathRef = useRef(previewPath);
  onSendRef.current = onSendDirectMessage;
  pathRef.current = previewPath;

  const debouncedSave = useCallback((content: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const path = pathRef.current;
      if (path && onSendRef.current) {
        setPreviewSaving(true);
        onSendRef.current({
          channel: 'file',
          action: 'write',
          requestId: generateRequestId(),
          data: { path, content },
        });
      }
    }, 500);
  }, [setPreviewSaving]);

  // 创建/销毁 CodeMirror
  useEffect(() => {
    if (!editorRef.current || !open || previewBinary || previewContent === null || !previewPath) {
      return;
    }

    const langExt = getLanguageExtension(previewPath);
    const extensions = [
      basicSetup,
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          debouncedSave(update.state.doc.toString());
        }
      }),
    ];
    if (langExt) extensions.push(langExt);

    const state = EditorState.create({
      doc: previewContent,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      // flush 未触发的保存
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const path = pathRef.current;
        const content = view.state.doc.toString();
        if (path && onSendRef.current && content !== previewContent) {
          onSendRef.current({
            channel: 'file',
            action: 'write',
            requestId: generateRequestId(),
            data: { path, content },
          });
        }
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [previewPath, previewBinary, open]);

  // 外部修改时更新编辑器内容（非编辑模式下自动重载后 previewContent 变化）
  useEffect(() => {
    if (viewRef.current && previewContent !== null) {
      const current = viewRef.current.state.doc.toString();
      if (current !== previewContent) {
        viewRef.current.dispatch({
          changes: { from: 0, to: current.length, insert: previewContent },
        });
      }
    }
  }, [previewContent]);

  // 清理 timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // 重载文件
  const handleReload = useCallback(() => {
    if (!previewPath) return;
    onSendDirectMessage({
      channel: 'file',
      action: 'read',
      requestId: generateRequestId(),
      data: { path: previewPath },
    });
  }, [previewPath, onSendDirectMessage]);

  // 保存状态
  const saveStatus = previewSaveError
    ? previewSaveError
    : previewSaving
      ? '保存中...'
      : null;

  return (
    <>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className={`relative cursor-col-resize shrink-0 z-5 flex items-center justify-center select-none ${
          open ? 'w-3' : 'w-0 hidden'
        }`}
      >
        <div className={`w-[3px] rounded-full transition-all duration-200 ${dragging ? 'h-12 bg-accent' : 'h-8 bg-slate-300 hover:bg-accent hover:h-12'}`} />
      </div>

      {/* Panel */}
      <div
        className={`bg-white border-l border-line-soft flex flex-col overflow-hidden shrink-0 ${
          open ? 'opacity-100' : 'w-0 min-w-0 opacity-0'
        }`}
        style={open ? { width: `${size}px` } : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[18px] border-b border-line-soft gap-3 min-h-14">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold whitespace-nowrap overflow-hidden text-ellipsis">
              {fileName || '未选择文件'}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-2">
              <span>{previewPath || ''}</span>
              {saveStatus && (
                <span className={previewSaveError ? 'text-red-500' : 'text-text-muted'}>
                  {saveStatus}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-text-muted shrink-0 transition-all duration-200 hover:bg-slate-100 hover:text-text-primary"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Changed banner (编辑中文件被外部修改) */}
        {previewChanged && (
          <div className="flex items-center justify-between px-[18px] py-2 bg-amber-50 border-b border-amber-200 shrink-0">
            <span className="text-xs text-amber-700">文件已被外部修改</span>
            <button
              onClick={handleReload}
              className="text-xs text-amber-700 underline hover:text-amber-900 transition-colors"
            >
              重新加载
            </button>
          </div>
        )}

        {/* Body: CodeMirror editor */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {previewLoading ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              加载中...
            </div>
          ) : previewBinary ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              二进制文件，无法编辑
            </div>
          ) : previewContent !== null ? (
            <div
              ref={editorRef}
              className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              无内容
            </div>
          )}
        </div>
      </div>
    </>
  );
}
