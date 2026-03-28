/**
 * InMemoryStore — 基于 Map 的内存 MemoryStore 实现
 *
 * 适用于单次运行、测试等无需持久化的场景。
 */

import type { MemoryStore, MemoryType, MemoryEntry } from './types.js';

export class InMemoryStore implements MemoryStore {
  private store = new Map<string, string>();
  private memories = new Map<string, MemoryEntry>();

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  upsertMemory(name: string, type: MemoryType, content: string): void {
    this.memories.set(name, {
      name,
      type,
      content,
      updatedAt: new Date(),
    });
  }

  getMemories(type?: MemoryType): MemoryEntry[] {
    const entries = [...this.memories.values()];
    const filtered = type ? entries.filter((e) => e.type === type) : entries;
    return filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  searchMemories(query: string, limit = 20): MemoryEntry[] {
    const lower = query.toLowerCase();
    const results = [...this.memories.values()].filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.content.toLowerCase().includes(lower),
    );
    return results
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
}
