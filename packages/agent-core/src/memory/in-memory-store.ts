/**
 * InMemoryStore — 基于 Map 的内存 MemoryStore 实现
 *
 * 适用于单次运行、测试等无需持久化的场景。
 */

import type { MemoryStore } from './types.js';

export class InMemoryStore implements MemoryStore {
  private store = new Map<string, string>();

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
}
