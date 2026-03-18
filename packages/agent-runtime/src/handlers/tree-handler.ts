import { readdir, stat as fsStat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validatePath } from '@ccclaw/shared';
import type { TreeEntry, TreeSnapshotData } from '@ccclaw/shared';

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_ENTRIES = 2000;

export class TreeHandler {
  constructor(private workspaceDir: string) {}

  async list(
    path: string,
    depth: number = DEFAULT_DEPTH,
    maxEntries: number = DEFAULT_MAX_ENTRIES,
  ): Promise<TreeSnapshotData> {
    // Normalize '/' to '.' so it refers to the workspace root, not filesystem root
    const normalizedPath = path === '/' ? '.' : path;
    const resolved = validatePath(this.workspaceDir, normalizedPath);
    const counter = { count: 0, truncated: false };
    const entries = await this.readDir(resolved, depth, maxEntries, counter);

    return {
      path,
      truncated: counter.truncated,
      entries,
    };
  }

  private async readDir(
    dirPath: string,
    depth: number,
    maxEntries: number,
    counter: { count: number; truncated: boolean },
  ): Promise<TreeEntry[]> {
    if (depth < 1 || counter.truncated) return [];

    const dirents = await readdir(dirPath, { withFileTypes: true });
    const entries: TreeEntry[] = [];

    // Sort: directories first, then alphabetical
    dirents.sort((a, b) => {
      const aIsDir = a.isDirectory() ? 0 : 1;
      const bIsDir = b.isDirectory() ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      return a.name.localeCompare(b.name);
    });

    for (const dirent of dirents) {
      if (counter.count >= maxEntries) {
        counter.truncated = true;
        break;
      }

      const fullPath = join(dirPath, dirent.name);
      const st = await fsStat(fullPath);

      const entry: TreeEntry = {
        name: dirent.name,
        type: dirent.isDirectory() ? 'directory' : 'file',
        size: st.size,
        mtime: st.mtimeMs,
      };

      counter.count++;

      if (dirent.isDirectory() && depth > 1) {
        entry.children = await this.readDir(fullPath, depth - 1, maxEntries, counter);
      }

      entries.push(entry);
    }

    return entries;
  }
}
