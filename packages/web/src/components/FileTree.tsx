import { useState } from 'react';
import { ChevronRightIcon, FolderIcon, FileIcon } from './icons';

interface TreeNode {
  name: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
}

// Stub 数据，后续接 API
const STUB_TREE: TreeNode[] = [
  {
    name: 'src', type: 'folder', children: [
      {
        name: 'components', type: 'folder', children: [
          { name: 'App.tsx', type: 'file' },
          { name: 'Header.tsx', type: 'file' },
        ],
      },
      { name: 'main.ts', type: 'file' },
      { name: 'index.html', type: 'file' },
    ],
  },
  { name: 'package.json', type: 'file' },
  { name: 'README.md', type: 'file' },
];

function TreeNodeItem({
  node,
  depth,
  selectedFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  onSelectFile: (name: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isFolder = node.type === 'folder';

  return (
    <div className="my-px">
      <button
        onClick={() => {
          if (isFolder) setOpen(!open);
          else onSelectFile(node.name);
        }}
        className={`w-full rounded-md min-h-[28px] px-2 flex items-center gap-0.5 text-text-primary transition-colors duration-200 hover:bg-slate-100 ${
          !isFolder && selectedFile === node.name ? 'bg-blue-100' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isFolder ? (
          <span className={`w-3.5 text-text-soft inline-flex justify-center shrink-0 text-[11px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
            <ChevronRightIcon className="w-3 h-3" />
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="w-4 text-center shrink-0 text-[13px]">
          {isFolder
            ? <FolderIcon className="w-4 h-4 text-blue-400" />
            : <FileIcon className="w-4 h-4 text-slate-400" />
          }
        </span>
        <span className="text-xs whitespace-nowrap overflow-hidden text-ellipsis ml-1">
          {node.name}
        </span>
      </button>
      {isFolder && open && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.name}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  onSelectFile?: (name: string) => void;
}

export function FileTree({ onSelectFile }: FileTreeProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleSelect = (name: string) => {
    setSelectedFile(name);
    onSelectFile?.(name);
  };

  return (
    <div className="px-1 overflow-y-auto flex-1 min-h-0">
      {STUB_TREE.map((node) => (
        <TreeNodeItem
          key={node.name}
          node={node}
          depth={0}
          selectedFile={selectedFile}
          onSelectFile={handleSelect}
        />
      ))}
    </div>
  );
}
