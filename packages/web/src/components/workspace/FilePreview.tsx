import { useFileTreeStore } from '../../stores/file-tree';

interface FilePreviewProps {
  onReload: () => void;
}

export function FilePreview({ onReload }: FilePreviewProps) {
  const previewPath = useFileTreeStore((s) => s.previewPath);
  const previewContent = useFileTreeStore((s) => s.previewContent);
  const previewBinary = useFileTreeStore((s) => s.previewBinary);
  const previewLoading = useFileTreeStore((s) => s.previewLoading);
  const previewChanged = useFileTreeStore((s) => s.previewChanged);

  if (!previewPath) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-text-muted">
        点击文件预览内容
      </div>
    );
  }

  if (previewLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-text-muted">
        加载中...
      </div>
    );
  }

  if (previewBinary) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-text-muted">
        二进制文件不可预览
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* File path header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line-soft bg-slate-50/50 shrink-0">
        <span className="text-[11px] text-text-soft truncate">{previewPath}</span>
      </div>

      {/* Changed banner */}
      {previewChanged && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-amber-50 border-b border-amber-200 shrink-0">
          <span className="text-xs text-amber-700">文件已变更，点击重新加载</span>
          <button
            onClick={onReload}
            className="text-xs text-amber-700 underline hover:text-amber-900 transition-colors"
          >
            重新加载
          </button>
        </div>
      )}

      {/* Content */}
      <pre className="flex-1 min-h-0 overflow-auto p-3 text-xs font-mono text-text-primary whitespace-pre-wrap break-words">
        {previewContent}
      </pre>
    </div>
  );
}
