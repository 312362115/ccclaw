import { useState, useCallback, type DragEvent } from 'react';
import type { TreeEntry } from '@ccclaw/shared';
import { useFileTreeStore } from '../../stores/file-tree';
import { ChevronRightIcon, FolderIcon, FileIcon } from '../icons';

interface FileTreeProps {
  onFileClick: (path: string) => void;
  onDeleteClick: (path: string, type: 'file' | 'directory') => void;
  onMoveFile?: (oldPath: string, newPath: string) => void;
}

function TreeNode({
  entry,
  depth,
  parentPath,
  previewPath,
  expandedPaths,
  dragOverPath,
  onToggleDir,
  onFileClick,
  onDeleteClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  entry: TreeEntry;
  depth: number;
  parentPath: string;
  previewPath: string | null;
  expandedPaths: Set<string>;
  dragOverPath: string | null;
  onToggleDir: (path: string) => void;
  onFileClick: (path: string) => void;
  onDeleteClick: (path: string, type: 'file' | 'directory') => void;
  onDragStart: (e: DragEvent, path: string) => void;
  onDragOver: (e: DragEvent, path: string) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent, targetDir: string) => void;
}) {
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isDir = entry.type === 'directory';
  const isExpanded = expandedPaths.has(fullPath);
  const isSelected = !isDir && previewPath === fullPath;
  const isDragOver = isDir && dragOverPath === fullPath;

  return (
    <div className="my-px">
      <button
        draggable
        onDragStart={(e) => onDragStart(e, fullPath)}
        onDragOver={(e) => { if (isDir) onDragOver(e, fullPath); }}
        onDragLeave={(e) => { if (isDir) onDragLeave(e); }}
        onDrop={(e) => { if (isDir) onDrop(e, fullPath); }}
        onClick={() => {
          if (isDir) onToggleDir(fullPath);
          else onFileClick(fullPath);
        }}
        className={`group w-full rounded-md min-h-[28px] px-2 flex items-center gap-0.5 text-text-primary transition-colors duration-200 hover:bg-slate-100 ${
          isSelected ? 'bg-blue-100' : ''
        } ${isDragOver ? 'bg-blue-50 ring-1 ring-blue-400' : ''}`}
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
              dragOverPath={dragOverPath}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
              onDeleteClick={onDeleteClick}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ onFileClick, onDeleteClick, onMoveFile }: FileTreeProps) {
  const entries = useFileTreeStore((s) => s.entries);
  const expandedPaths = useFileTreeStore((s) => s.expandedPaths);
  const previewPath = useFileTreeStore((s) => s.previewPath);
  const toggleDir = useFileTreeStore((s) => s.toggleDir);

  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const handleDragStart = useCallback((e: DragEvent, path: string) => {
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: DragEvent, path: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(path);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    // 只在真正离开时清除（忽略子元素触发的 leave）
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    setDragOverPath(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent, targetDir: string) => {
    e.preventDefault();
    setDragOverPath(null);
    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath || !onMoveFile) return;

    // 不能移动到自身或自身的子目录
    if (targetDir === sourcePath || targetDir.startsWith(sourcePath + '/')) return;

    const fileName = sourcePath.split('/').pop()!;
    const newPath = `${targetDir}/${fileName}`;

    // 源和目标相同则跳过
    if (newPath === sourcePath) return;

    onMoveFile(sourcePath, newPath);
  }, [onMoveFile]);

  const handleRootDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath('__root__');
  }, []);

  const handleRootDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOverPath(null);
    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath || !onMoveFile) return;

    // 已经在根目录则跳过
    if (!sourcePath.includes('/')) return;

    const fileName = sourcePath.split('/').pop()!;
    onMoveFile(sourcePath, fileName);
  }, [onMoveFile]);

  const isRootDragOver = dragOverPath === '__root__';

  return (
    <div
      className={`px-1 overflow-y-auto flex-1 min-h-0 ${isRootDragOver ? 'bg-blue-50/50' : ''}`}
      onDragOver={handleRootDragOver}
      onDrop={handleRootDrop}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (related && (e.currentTarget as Node).contains(related)) return;
        setDragOverPath(null);
      }}
    >
      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          depth={0}
          parentPath=""
          previewPath={previewPath}
          expandedPaths={expandedPaths}
          dragOverPath={dragOverPath}
          onToggleDir={toggleDir}
          onFileClick={onFileClick}
          onDeleteClick={onDeleteClick}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />
      ))}
      {entries.length === 0 && (
        <div className="text-[12px] text-text-muted text-center py-4">暂无文件</div>
      )}
    </div>
  );
}
