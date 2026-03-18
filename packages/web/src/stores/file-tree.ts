import { create } from 'zustand';
import type { TreeEntry, TreeEvent } from '@ccclaw/shared';

// ── Tree manipulation helpers ────────────────────────────────────────────────

/** Navigate tree by path parts to find the parent children array. */
function findParent(entries: TreeEntry[], pathParts: string[]): TreeEntry[] | null {
  let current = entries;
  for (const part of pathParts) {
    const node = current.find((e) => e.name === part && e.type === 'directory');
    if (!node) return null;
    if (!node.children) node.children = [];
    current = node.children;
  }
  return current;
}

/** Sort: directories first, then alphabetical (case-insensitive). */
function sortEntries(entries: TreeEntry[]): void {
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function insertEntry(entries: TreeEntry[], event: TreeEvent): void {
  const parts = event.path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = parts.length === 0 ? entries : findParent(entries, parts);
  if (!parent) return;

  // Avoid duplicates
  if (parent.some((e) => e.name === name)) return;

  const entry: TreeEntry = {
    name,
    type: event.entryType,
    size: event.size,
    mtime: event.mtime,
  };
  if (entry.type === 'directory') entry.children = [];
  parent.push(entry);
  sortEntries(parent);
}

function removeEntry(entries: TreeEntry[], path: string): void {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = parts.length === 0 ? entries : findParent(entries, parts);
  if (!parent) return;

  const idx = parent.findIndex((e) => e.name === name);
  if (idx !== -1) parent.splice(idx, 1);
}

function updateEntry(entries: TreeEntry[], event: TreeEvent): void {
  const parts = event.path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = parts.length === 0 ? entries : findParent(entries, parts);
  if (!parent) return;

  const node = parent.find((e) => e.name === name);
  if (!node) return;
  if (event.size !== undefined) node.size = event.size;
  if (event.mtime !== undefined) node.mtime = event.mtime;
}

function mergeChildren(entries: TreeEntry[], parentPath: string, children: TreeEntry[]): void {
  const parts = parentPath.split('/').filter(Boolean);
  const parent = parts.length === 0 ? entries : findParent(entries, parts);
  if (!parent) return;

  // Find the directory node itself (last part of the path)
  // If parentPath points to root, we replace entries directly — handled by caller.
  const dirName = parts.pop();
  if (!dirName) {
    // parentPath is root — replace top-level
    entries.length = 0;
    entries.push(...children);
    sortEntries(entries);
    return;
  }

  // Re-navigate to grandparent to find the directory node
  const grandparent = parts.length === 0 ? entries : findParent(entries, parts);
  if (!grandparent) return;

  const dirNode = grandparent.find((e) => e.name === dirName && e.type === 'directory');
  if (!dirNode) return;

  dirNode.children = children;
  sortEntries(dirNode.children);
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface FileTreeState {
  entries: TreeEntry[];
  loading: boolean;
  truncated: boolean;
  expandedPaths: Set<string>;

  // Preview
  previewPath: string | null;
  previewContent: string | null;
  previewBinary: boolean;
  previewLoading: boolean;
  previewChanged: boolean;

  // Connection
  connectionState: 'INIT' | 'CONNECTING' | 'DIRECT' | 'TUNNEL_CONNECTING' | 'TUNNEL' | 'RELAY' | 'DISCONNECTED';

  // Actions
  setEntries: (entries: TreeEntry[], truncated: boolean) => void;
  applyEvents: (events: TreeEvent[]) => void;
  toggleDir: (path: string) => void;
  setPreview: (path: string | null, content: string | null, binary: boolean) => void;
  setPreviewLoading: (loading: boolean) => void;
  setPreviewChanged: (changed: boolean) => void;
  setConnectionState: (state: FileTreeState['connectionState']) => void;
  setLoading: (loading: boolean) => void;
  mergeSubtree: (parentPath: string, children: TreeEntry[]) => void;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  entries: [],
  loading: false,
  truncated: false,
  expandedPaths: new Set(),

  previewPath: null,
  previewContent: null,
  previewBinary: false,
  previewLoading: false,
  previewChanged: false,

  connectionState: 'INIT',

  setEntries: (entries, truncated) => set({ entries, truncated, loading: false }),

  applyEvents: (events) => {
    const state = get();
    // Deep clone entries so mutations don't affect previous state
    const next = structuredClone(state.entries);
    let previewChanged = state.previewChanged;

    for (const event of events) {
      switch (event.type) {
        case 'created':
          insertEntry(next, event);
          break;
        case 'deleted':
          removeEntry(next, event.path);
          break;
        case 'modified':
          updateEntry(next, event);
          if (state.previewPath === event.path) {
            previewChanged = true;
          }
          break;
      }
    }

    set({ entries: next, previewChanged });
  },

  toggleDir: (path) => {
    const state = get();
    const next = new Set(state.expandedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    set({ expandedPaths: next });
  },

  setPreview: (path, content, binary) =>
    set({ previewPath: path, previewContent: content, previewBinary: binary, previewChanged: false }),

  setPreviewLoading: (loading) => set({ previewLoading: loading }),

  setPreviewChanged: (changed) => set({ previewChanged: changed }),

  setConnectionState: (connectionState) => set({ connectionState }),

  setLoading: (loading) => set({ loading }),

  mergeSubtree: (parentPath, children) => {
    const next = structuredClone(get().entries);
    mergeChildren(next, parentPath, children);
    set({ entries: next });
  },
}));
