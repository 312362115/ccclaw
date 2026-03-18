import { useResizable } from '../../hooks/useResizable';
import { CloseIcon } from '../../components/icons';
import { useFileTreeStore } from '../../stores/file-tree';

export function FilePreviewPanel() {
  const previewPath = useFileTreeStore((s) => s.previewPath);
  const previewContent = useFileTreeStore((s) => s.previewContent);
  const previewBinary = useFileTreeStore((s) => s.previewBinary);
  const previewLoading = useFileTreeStore((s) => s.previewLoading);
  const setPreview = useFileTreeStore((s) => s.setPreview);

  const open = previewPath !== null;

  const { size, dragging, onMouseDown } = useResizable({
    storageKey: 'cc-preview-width',
    defaultSize: 480,
    minSize: 320,
    maxSize: 900,
    direction: 'horizontal',
  });

  const handleClose = () => setPreview(null, null, false);

  // 从路径提取文件名
  const fileName = previewPath?.split('/').pop() ?? null;

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
            <div className="text-[11px] text-text-muted mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
              {previewPath || ''}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-text-muted shrink-0 transition-all duration-200 hover:bg-slate-100 hover:text-text-primary"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto">
          {previewLoading ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              加载中...
            </div>
          ) : previewBinary ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              二进制文件，无法预览
            </div>
          ) : previewContent !== null ? (
            <pre className="bg-slate-900 text-slate-200 px-[18px] py-4 font-mono text-xs leading-[1.7] whitespace-pre-wrap break-words min-h-full m-0">
              {previewContent}
            </pre>
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
