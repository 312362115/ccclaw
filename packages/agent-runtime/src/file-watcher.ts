import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { TreeEvent } from '@ccclaw/shared';

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.cache',
  '.next',
  '.nuxt',
];

export interface FileWatcherOptions {
  debounceMs?: number;
  ignorePatterns?: string[];
  maxDepth?: number;
}

export class FileWatcher extends EventEmitter {
  private readonly rootDir: string;
  private readonly debounceMs: number;
  private readonly ignorePatterns: string[];
  private readonly maxDepth: number;
  private readonly knownPaths = new Set<string>();
  private pendingEvents = new Map<string, TreeEvent>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;

  constructor(rootDir: string, options?: FileWatcherOptions) {
    super();
    this.rootDir = rootDir;
    this.debounceMs = options?.debounceMs ?? 200;
    this.ignorePatterns = options?.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
    this.maxDepth = options?.maxDepth ?? 10;
  }

  async start(): Promise<void> {
    await this.scanExisting(this.rootDir, 0);
    this.watcher = watch(this.rootDir, { recursive: true }, (_eventType, filename) => {
      if (filename) {
        this.handleChange(filename);
      }
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private shouldIgnore(relativePath: string): boolean {
    const parts = relativePath.split(sep);
    return parts.some(part => this.ignorePatterns.includes(part));
  }

  private toEventPath(relativePath: string): string {
    // Normalize to forward slashes and prefix with /
    return '/' + relativePath.split(sep).join('/');
  }

  private async scanExisting(dir: string, depth: number): Promise<void> {
    if (depth > this.maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (this.ignorePatterns.includes(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      const relPath = relative(this.rootDir, fullPath);
      const eventPath = this.toEventPath(relPath);

      this.knownPaths.add(eventPath);

      if (entry.isDirectory()) {
        await this.scanExisting(fullPath, depth + 1);
      }
    }
  }

  private async handleChange(filename: string): Promise<void> {
    if (this.shouldIgnore(filename)) return;

    const eventPath = this.toEventPath(filename);
    const fullPath = join(this.rootDir, filename);

    try {
      const st = await stat(fullPath);
      const isKnown = this.knownPaths.has(eventPath);
      const eventType: TreeEvent['type'] = isKnown ? 'modified' : 'created';

      this.knownPaths.add(eventPath);

      const event: TreeEvent = {
        type: eventType,
        path: eventPath,
        entryType: st.isDirectory() ? 'directory' : 'file',
        size: st.isFile() ? st.size : undefined,
        mtime: st.mtimeMs,
      };

      this.pendingEvents.set(eventPath, event);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.knownPaths.delete(eventPath);

        const event: TreeEvent = {
          type: 'deleted',
          path: eventPath,
          entryType: 'file', // We can't stat a deleted path, default to file
        };

        this.pendingEvents.set(eventPath, event);
      }
      // Ignore other errors
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    if (this.pendingEvents.size === 0) return;

    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();
    this.debounceTimer = null;

    this.emit('events', events);
  }
}
