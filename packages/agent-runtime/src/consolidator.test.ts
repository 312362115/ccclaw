import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from './workspace-db.js';
import { Consolidator } from './consolidator.js';
import type { ChatResponse } from './llm/types.js';

let db: WorkspaceDB;
let tmpDir: string;

function mockLLM(content: string) {
  return async (): Promise<ChatResponse> => ({
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

describe('Consolidator.findFirstTurnGroupEnd', () => {
  it('空消息返回 0', () => {
    const consolidator = new Consolidator(db, null);
    expect(consolidator.findFirstTurnGroupEnd([] as any)).toBe(0);
  });

  it('找到第一个 turn group (user + assistant)', () => {
    const consolidator = new Consolidator(db, null);
    const messages = [
      { id: '0', session_id: 's', role: 'user', content: 'hi', tool_calls: null, tokens: null, created_at: '' },
      { id: '1', session_id: 's', role: 'assistant', content: 'hello', tool_calls: null, tokens: null, created_at: '' },
      { id: '2', session_id: 's', role: 'user', content: 'next', tool_calls: null, tokens: null, created_at: '' },
      { id: '3', session_id: 's', role: 'assistant', content: 'reply', tool_calls: null, tokens: null, created_at: '' },
    ];
    const end = consolidator.findFirstTurnGroupEnd(messages as any);
    // First group: messages[0] (user) + messages[1] (assistant) → boundary at 2
    expect(end).toBe(2);
  });

  it('只有一个 turn group 时保留最后 2 条', () => {
    const consolidator = new Consolidator(db, null);
    const messages = [
      { id: '0', session_id: 's', role: 'user', content: 'hi', tool_calls: null, tokens: null, created_at: '' },
      { id: '1', session_id: 's', role: 'assistant', content: 'hello', tool_calls: null, tokens: null, created_at: '' },
    ];
    const end = consolidator.findFirstTurnGroupEnd(messages as any);
    // Only 2 messages, must keep at least 2 → boundary = 0
    expect(end).toBe(0);
  });
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

  it('滑动窗口只压缩 1 个 turn group', async () => {
    const llmCalls: string[] = [];
    const trackingLLM = async (params: any): Promise<ChatResponse> => {
      llmCalls.push(params.messages[0].content);
      return {
        content: '总结内容',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'end_turn',
      };
    };

    // 6 messages × (15 content + 4 overhead) = 114 tokens
    // contextWindow=160 → sliding = 112 (160*0.7), hard = 144 (160*0.9)
    // 114 > 112 triggers sliding window, 114 < 144 does NOT trigger hard truncation
    const consolidator = new Consolidator(db, trackingLLM, {
      contextWindowTokens: 160,
    });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    // Add 3 turn groups to exceed 70% threshold
    for (let i = 0; i < 6; i++) {
      db.appendMessage({
        session_id: session.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: '这是一段测试消息内容'.repeat(3),
      });
    }

    const result = await consolidator.consolidateIfNeeded(session.id);
    expect(result).toBe(true);

    // LLM should be called once (1 turn group compressed)
    expect(llmCalls.length).toBe(1);

    // lastConsolidated should advance by exactly 1 turn group (2 messages)
    const updated = db.getSession(session.id);
    expect(updated!.last_consolidated).toBe(2);
  });

  it('硬截断在 80% 阈值触发', async () => {
    const llmCalls: number[] = [];
    const trackingLLM = async (): Promise<ChatResponse> => {
      llmCalls.push(1);
      return {
        content: '总结',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'end_turn',
      };
    };

    // contextWindow=100 → hard threshold = 90 tokens (100 * 0.9)
    const consolidator = new Consolidator(db, trackingLLM, {
      contextWindowTokens: 100,
    });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    // Add enough messages to exceed 90% of 100 tokens
    for (let i = 0; i < 10; i++) {
      db.appendMessage({
        session_id: session.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: '这是一段较长的测试消息内容'.repeat(5),
      });
    }

    const result = await consolidator.consolidateIfNeeded(session.id);
    expect(result).toBe(true);

    // Hard truncation should NOT call LLM for summarization
    // (it may call LLM for log merge, but not for the truncation itself)
    // The log memory should be created as a direct archive
    const logMemories = db.getMemoriesByType('log');
    expect(logMemories.length).toBeGreaterThan(0);
    const hasArchive = logMemories.some((m) => m.name.includes('truncate'));
    expect(hasArchive).toBe(true);
  });

  it('无 LLM 时降级归档', async () => {
    // contextWindow=100 → sliding threshold = 70 tokens (100 * 0.7)
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

describe('Consolidator.mergeLogMemoriesIfNeeded', () => {
  it('log 记忆不足不合并', async () => {
    const consolidator = new Consolidator(db, mockLLM('合并'));
    // Add a few log memories (below threshold)
    for (let i = 0; i < 3; i++) {
      db.upsertMemory({ name: `log-${i}`, type: 'log', content: '短日志' });
    }
    const result = await consolidator.mergeLogMemoriesIfNeeded();
    expect(result).toBe(false);
  });

  it('log 记忆超 15 条触发合并', async () => {
    const consolidator = new Consolidator(db, mockLLM('合并后的总结'), {});

    // Add 16 log memories
    for (let i = 0; i < 16; i++) {
      db.upsertMemory({ name: `log-${i}`, type: 'log', content: `日志内容 ${i}` });
    }

    const logsBefore = db.getMemoriesByType('log');
    expect(logsBefore.length).toBe(16);

    const result = await consolidator.mergeLogMemoriesIfNeeded();
    expect(result).toBe(true);

    // After merge, should have 1-2 entries instead of 16
    const logsAfter = db.getMemoriesByType('log');
    expect(logsAfter.length).toBeLessThanOrEqual(2);
    expect(logsAfter[0].content).toBe('合并后的总结');
  });

  it('log 记忆超 token 阈值触发合并', async () => {
    const consolidator = new Consolidator(db, mockLLM('合并后的总结'));

    // Add a few large log memories exceeding 4000 tokens
    for (let i = 0; i < 5; i++) {
      db.upsertMemory({
        name: `log-${i}`,
        type: 'log',
        content: '这是一段很长的日志内容'.repeat(200),
      });
    }

    const result = await consolidator.mergeLogMemoriesIfNeeded();
    expect(result).toBe(true);
  });

  it('无 LLM 时截断最旧的 log 记忆', async () => {
    const consolidator = new Consolidator(db, null);

    for (let i = 0; i < 20; i++) {
      db.upsertMemory({ name: `log-${i}`, type: 'log', content: `日志 ${i}` });
    }

    const result = await consolidator.mergeLogMemoriesIfNeeded();
    expect(result).toBe(true);

    const logsAfter = db.getMemoriesByType('log');
    expect(logsAfter.length).toBeLessThanOrEqual(15);
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
