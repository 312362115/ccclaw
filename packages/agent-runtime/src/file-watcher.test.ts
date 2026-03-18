import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TreeEvent } from '@ccclaw/shared';
import { FileWatcher } from './file-watcher.js';

function waitForEvents(
  watcher: FileWatcher,
  count: number,
  timeoutMs = 5000,
): Promise<TreeEvent[]> {
  return new Promise<TreeEvent[]>((resolve, reject) => {
    const collected: TreeEvent[] = [];
    const timer = setTimeout(() => {
      watcher.removeAllListeners('events');
      if (collected.length > 0) {
        resolve(collected);
      } else {
        reject(new Error(`Timed out waiting for ${count} events, got ${collected.length}`));
      }
    }, timeoutMs);

    watcher.on('events', (events: TreeEvent[]) => {
      collected.push(...events);
      if (collected.length >= count) {
        clearTimeout(timer);
        watcher.removeAllListeners('events');
        resolve(collected);
      }
    });
  });
}

describe('FileWatcher', () => {
  let tmpDir: string;
  let watcher: FileWatcher;

  afterEach(async () => {
    watcher?.stop();
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('should emit created event for a new file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-test-'));
    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    await watcher.start();

    const eventsPromise = waitForEvents(watcher, 1);
    await writeFile(join(tmpDir, 'hello.txt'), 'world');
    const events = await eventsPromise;

    const created = events.find(e => e.path === '/hello.txt' && e.type === 'created');
    expect(created).toBeDefined();
    expect(created!.entryType).toBe('file');
  });

  it('should emit deleted event when a file is removed', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-test-'));
    const filePath = join(tmpDir, 'remove-me.txt');
    await writeFile(filePath, 'bye');

    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    await watcher.start();

    const eventsPromise = waitForEvents(watcher, 1);
    await rm(filePath);
    const events = await eventsPromise;

    const deleted = events.find(e => e.path === '/remove-me.txt' && e.type === 'deleted');
    expect(deleted).toBeDefined();
  });

  it('should ignore files in node_modules', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-test-'));
    await mkdir(join(tmpDir, 'node_modules'), { recursive: true });

    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    await watcher.start();

    // Write a file inside node_modules — should be ignored
    await writeFile(join(tmpDir, 'node_modules', 'pkg.js'), 'x');

    // Also write a normal file so we know the watcher is working
    const eventsPromise = waitForEvents(watcher, 1);
    await writeFile(join(tmpDir, 'real.txt'), 'data');
    const events = await eventsPromise;

    const nmEvent = events.find(e => e.path.includes('node_modules'));
    expect(nmEvent).toBeUndefined();

    const realEvent = events.find(e => e.path === '/real.txt');
    expect(realEvent).toBeDefined();
  });

  it('should emit modified event for content change on existing file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fw-test-'));
    const filePath = join(tmpDir, 'existing.txt');
    await writeFile(filePath, 'original');

    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    await watcher.start();

    // macOS fs.watch({ recursive }) needs a moment to become ready
    await new Promise(r => setTimeout(r, 100));

    const eventsPromise = waitForEvents(watcher, 1);
    await writeFile(filePath, 'updated');
    const events = await eventsPromise;

    const modified = events.find(e => e.path === '/existing.txt' && e.type === 'modified');
    expect(modified).toBeDefined();
    expect(modified!.entryType).toBe('file');
  });
});
