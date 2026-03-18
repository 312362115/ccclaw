import type { TreeEntry } from '@ccclaw/shared';
import { useFileTreeStore } from '../../stores/file-tree';
import { ChevronRightIcon, FolderIcon, FileIcon } from '../icons';

interface FileTreeProps {
  onFileClick: (path: string) => void;
  onDeleteClick: (path: string, type: 'file' | 'directory') => void;
}

function TreeNode({
  entry,
  depth,
  parentPath,
  previewPath,
  expandedPaths,
  onToggleDir,
  onFileClick,
  onDeleteClick,
}: {
  entry: TreeEntry;
  depth: number;
  parentPath: string;
  previewPath: string | null;
  expandedPaths: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (path: string) => void;
  onDeleteClick: (path: string, type: 'file' | 'directory') => void;
}) {
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isDir = entry.type === 'directory';
  const isExpanded = expandedPaths.has(fullPath);
  const isSelected = !isDir && previewPath === fullPath;

  return (
    <div className="my-px">
      <button
        onClick={() => {
          if (isDir) onToggleDir(fullPath);
          else onFileClick(fullPath);
        }}
        className={`group w-full rounded-md min-h-[28px] px-2 flex items-center gap-0.5 text-text-primary transition-colors duration-200 hover:bg-slate-100 ${
          isSelected ? 'bg-blue-100' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          <span
            className={`w-3.5 text-text-soft inline-flex justify-center shrink-0 text-[11px] transition-transform duration-200 ${
              isExpanded ? 'rotate-90' : ''
            }`}
          >
            <ChevronRightIcon className="w-3 h-3" />
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="w-4 text-center shrink-0 text-[13px]">
          {isDir ? (
            <FolderIcon className="w-4 h-4 text-blue-400" />
          ) : (
            <FileIcon className="w-4 h-4 text-slate-400" />
          )}
        </span>
        <span className="text-xs whitespace-nowrap overflow-hidden text-ellipsis ml-1 flex-1 text-left">
          {entry.name}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(fullPath, entry.type);
          }}
          className="text-[11px] text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ml-1 shrink-0 cursor-pointer px-0.5"
        >
          ✕
        </span>
      </button>
      {isDir && isExpanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              depth={depth + 1}
              parentPath={fullPath}
              previewPath={previewPath}
              expandedPaths={expandedPaths}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
              onDeleteClick={onDeleteClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ onFileClick, onDeleteClick }: FileTreeProps) {
  const entries = useFileTreeStore((s) => s.entries);
  const expandedPaths = useFileTreeStore((s) => s.expandedPaths);
  const previewPath = useFileTreeStore((s) => s.previewPath);
  const toggleDir = useFileTreeStore((s) => s.toggleDir);

  return (
    <div className="px-1 overflow-y-auto flex-1 min-h-0">
      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          depth={0}
          parentPath=""
          previewPath={previewPath}
          expandedPaths={expandedPaths}
          onToggleDir={toggleDir}
          onFileClick={onFileClick}
          onDeleteClick={onDeleteClick}
        />
      ))}
      {entries.length === 0 && (
        <div className="text-[12px] text-text-muted text-center py-4">暂无文件</div>
      )}
    </div>
  );
}
