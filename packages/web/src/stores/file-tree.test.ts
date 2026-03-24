import { describe, it, expect, beforeEach } from 'vitest';
import { useFileTreeStore } from './file-tree';
import type { TreeEntry, TreeEvent } from '@ccclaw/shared';

function resetStore() {
  useFileTreeStore.setState({
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
  });
}

describe('file-tree store', () => {
  beforeEach(resetStore);

  describe('setEntries', () => {
    it('should set entries and loading state', () => {
      const entries: TreeEntry[] = [
        { name: 'src', type: 'directory', children: [] },
        { name: 'README.md', type: 'file', size: 100 },
      ];
      useFileTreeStore.getState().setEntries(entries, false);

      expect(useFileTreeStore.getState().entries).toHaveLength(2);
      expect(useFileTreeStore.getState().loading).toBe(false);
      expect(useFileTreeStore.getState().truncated).toBe(false);
    });
  });

  describe('applyEvents', () => {
    it('should insert new file', () => {
      useFileTreeStore.getState().setEntries([
        { name: 'src', type: 'directory', children: [] },
      ], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'created', path: 'index.ts', entryType: 'file', size: 50, mtime: 1735689600000 },
      ]);

      const entries = useFileTreeStore.getState().entries;
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.name === 'index.ts')).toBeDefined();
    });

    it('should insert file in nested directory', () => {
      useFileTreeStore.getState().setEntries([
        { name: 'src', type: 'directory', children: [] },
      ], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'created', path: 'src/app.ts', entryType: 'file', size: 100, mtime: 1735689600000 },
      ]);

      const src = useFileTreeStore.getState().entries.find((e) => e.name === 'src');
      expect(src?.children).toHaveLength(1);
      expect(src?.children?.[0].name).toBe('app.ts');
    });

    it('should delete file', () => {
      useFileTreeStore.getState().setEntries([
        { name: 'a.ts', type: 'file', size: 10 },
        { name: 'b.ts', type: 'file', size: 20 },
      ], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'deleted', path: 'a.ts', entryType: 'file' },
      ]);

      expect(useFileTreeStore.getState().entries).toHaveLength(1);
      expect(useFileTreeStore.getState().entries[0].name).toBe('b.ts');
    });

    it('should update file metadata', () => {
      useFileTreeStore.getState().setEntries([
        { name: 'file.ts', type: 'file', size: 10, mtime: 1735689600000 },
      ], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'modified', path: 'file.ts', entryType: 'file', size: 200, mtime: 1735776000000 },
      ]);

      expect(useFileTreeStore.getState().entries[0].size).toBe(200);
    });

    it('should mark preview as changed when modified file is previewed', () => {
      useFileTreeStore.setState({ previewPath: 'file.ts' });
      useFileTreeStore.getState().setEntries([
        { name: 'file.ts', type: 'file', size: 10 },
      ], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'modified', path: 'file.ts', entryType: 'file', size: 50 },
      ]);

      expect(useFileTreeStore.getState().previewChanged).toBe(true);
    });

    it('should not create duplicates', () => {
      useFileTreeStore.getState().setEntries([
        { name: 'file.ts', type: 'file', size: 10 },
      ], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'created', path: 'file.ts', entryType: 'file', size: 10 },
      ]);

      expect(useFileTreeStore.getState().entries).toHaveLength(1);
    });
  });

  describe('toggleDir', () => {
    it('should toggle directory expansion', () => {
      const { toggleDir } = useFileTreeStore.getState();

      toggleDir('src');
      expect(useFileTreeStore.getState().expandedPaths.has('src')).toBe(true);

      toggleDir('src');
      expect(useFileTreeStore.getState().expandedPaths.has('src')).toBe(false);
    });
  });

  describe('mergeSubtree', () => {
    it('should replace children of a directory', () => {
      useFileTreeStore.getState().setEntries([
        { name: 'src', type: 'directory', children: [
          { name: 'old.ts', type: 'file', size: 10 },
        ] },
      ], false);

      useFileTreeStore.getState().mergeSubtree('src', [
        { name: 'new1.ts', type: 'file', size: 20 },
        { name: 'new2.ts', type: 'file', size: 30 },
      ]);

      const src = useFileTreeStore.getState().entries.find((e) => e.name === 'src');
      expect(src?.children).toHaveLength(2);
      expect(src?.children?.[0].name).toBe('new1.ts');
    });
  });

  describe('sorting', () => {
    it('should sort directories before files', () => {
      useFileTreeStore.getState().setEntries([], false);

      useFileTreeStore.getState().applyEvents([
        { type: 'created', path: 'b.ts', entryType: 'file', size: 10 },
        { type: 'created', path: 'a-dir', entryType: 'directory' },
        { type: 'created', path: 'a.ts', entryType: 'file', size: 10 },
      ]);

      const names = useFileTreeStore.getState().entries.map((e) => e.name);
      expect(names).toEqual(['a-dir', 'a.ts', 'b.ts']);
    });
  });
});
