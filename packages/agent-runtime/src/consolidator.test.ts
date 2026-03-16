import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from './workspace-db.js';
import { Consolidator } from './consolidator.js';
import type { LLMResponse } from './llm-client.js';

let db: WorkspaceDB;
let tmpDir: string;

function mockLLM(content: string) {
  return async (): Promise<LLMResponse> => ({
    content,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: 'end_turn',
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'consolidator-test-'));
  db = new WorkspaceDB(join(tmpDir, 'test.db'));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Consolidator.pickBoundary', () => {
  it('消息不足不需要切割', () => {
    const consolidator = new Consolidator(db, null);
    const messages = [
      { id: '1', session_id: 's', role: 'user', content: 'hi', tool_calls: null, tokens: null, created_at: '' },
    ];
    const boundary = consolidator.pickBoundary(messages as any, 100);
    // 单条消息 token < 100，不够切割
    expect(boundary).toBe(0);
  });

  it('正确找到切割边界', () => {
    const consolidator = new Consolidator(db, null);
    // 每条约 250 token（1000 chars * 0.25）
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      session_id: 's',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'a'.repeat(1000),
      tool_calls: null,
      tokens: null,
      created_at: '',
    }));

    // 需要移除约 500 tokens → 前 2 条
    const boundary = consolidator.pickBoundary(messages as any, 500);
    expect(boundary).toBeGreaterThan(0);
    expect(boundary).toBeLessThan(messages.length - 1);
  });

  it('边界对齐到 user 消息', () => {
    const consolidator = new Consolidator(db, null);
    const messages = [
      { id: '0', session_id: 's', role: 'user', content: 'a'.repeat(1000), tool_calls: null, tokens: null, created_at: '' },
      { id: '1', session_id: 's', role: 'assistant', content: 'a'.repeat(1000), tool_calls: null, tokens: null, created_at: '' },
      { id: '2', session_id: 's', role: 'user', content: 'a'.repeat(100), tool_calls: null, tokens: null, created_at: '' },
      { id: '3', session_id: 's', role: 'assistant', content: 'a'.repeat(100), tool_calls: null, tokens: null, created_at: '' },
    ];

    // 需要移除约 250 tokens → 边界在第 1 条后，但应前移到 user 消息
    const boundary = consolidator.pickBoundary(messages as any, 250);
    if (boundary > 0 && boundary < messages.length) {
      expect(messages[boundary].role).toBe('user');
    }
  });
});

describe('Consolidator.consolidateIfNeeded', () => {
  it('token 未超阈值不整合', async () => {
    const consolidator = new Consolidator(db, null, { contextWindowTokens: 100000 });
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    db.appendMessage({ session_id: session.id, role: 'user', content: 'hello' });

    const result = await consolidator.consolidateIfNeeded(session.id);
    expect(result).toBe(false);
  });

  it('超阈值时触发整合', async () => {
    // 使用极小的窗口来触发整合
    const consolidator = new Consolidator(db, mockLLM('总结内容'), {
      contextWindowTokens: 100, // 极小窗口
    });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    // 添加足够多的消息超过 50 token（100 * 0.5）
    for (let i = 0; i < 10; i++) {
      db.appendMessage({
        session_id: session.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: '这是一段较长的测试消息内容'.repeat(5),
      });
    }

    const result = await consolidator.consolidateIfNeeded(session.id);
    expect(result).toBe(true);

    // lastConsolidated 应该前进了
    const updated = db.getSession(session.id);
    expect(updated!.last_consolidated).toBeGreaterThan(0);
  });

  it('无 LLM 时降级归档', async () => {
    const consolidator = new Consolidator(db, null, { contextWindowTokens: 100 });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    for (let i = 0; i < 10; i++) {
      db.appendMessage({
        session_id: session.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: '降级测试消息'.repeat(10),
      });
    }

    const result = await consolidator.consolidateIfNeeded(session.id);
    expect(result).toBe(true);
  });

  it('session 不存在返回 false', async () => {
    const consolidator = new Consolidator(db, null);
    const result = await consolidator.consolidateIfNeeded('nonexistent');
    expect(result).toBe(false);
  });
});

describe('Consolidator.compressMemoriesIfNeeded', () => {
  it('无记忆不压缩', async () => {
    const consolidator = new Consolidator(db, null);
    const result = await consolidator.compressMemoriesIfNeeded();
    expect(result).toBe(false);
  });

  it('记忆未超阈值不压缩', async () => {
    const consolidator = new Consolidator(db, mockLLM('压缩'), { memoryCompressThreshold: 10000 });
    db.upsertMemory({ name: 'r1', type: 'decision', content: '短内容' });
    const result = await consolidator.compressMemoriesIfNeeded();
    expect(result).toBe(false);
  });

  it('超阈值时调用 LLM 压缩', async () => {
    const consolidator = new Consolidator(db, mockLLM('压缩后的内容'), {
      memoryCompressThreshold: 10,
    });

    db.upsertMemory({ name: 'long-decision', type: 'decision', content: '很长的决策内容'.repeat(500) });

    const result = await consolidator.compressMemoriesIfNeeded();
    expect(result).toBe(true);

    const mem = db.getMemory('long-decision');
    expect(mem!.compressed).toBe(1);
    expect(mem!.compressed_content).toBe('压缩后的内容');
  });

  it('无 LLM 回调不压缩', async () => {
    const consolidator = new Consolidator(db, null, { memoryCompressThreshold: 10 });
    db.upsertMemory({ name: 'long', type: 'decision', content: '很长'.repeat(100) });
    const result = await consolidator.compressMemoriesIfNeeded();
    expect(result).toBe(false);
  });
});
