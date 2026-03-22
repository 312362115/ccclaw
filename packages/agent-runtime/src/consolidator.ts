/**
 * Consolidator — 批量上下文整合
 *
 * 1. 批量压缩：未压缩消息 token > contextWindow * bulkRatio 时，
 *    一次性压缩到 50% 以下（减少 LLM 调用次数，适配按次计费模型）
 * 2. 硬截断：总 token > contextWindow * hardRatio 时，跳过 LLM，直接截断到 log memory
 *
 * bulkRatio / hardRatio 根据窗口大小对数缩放：
 *   - 8K 窗口：bulk=70%, hard=80%（小窗口更早触发，留足缓冲）
 *   - 1M 窗口：bulk=85%, hard=95%（大窗口可以更激进利用空间）
 * 3. Log 记忆合并：log 记忆 > 20 条 OR > 6000 tokens 时，LLM 合并为 1-2 条
 *
 * contextWindowTokens 应从 Provider capabilities 中获取，自动适配不同模型。
 * 记忆压缩：当 decision + feedback 总 token 超过阈值时，调用 LLM 合并压缩。
 */

import type { WorkspaceDB, Message } from './workspace-db.js';
import { estimateTokens, estimateMessagesTokens } from './utils/token-estimator.js';
import type { ChatResponse } from './llm/types.js';

// ====== Types ======

export interface ConsolidatorLLMCall {
  (params: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<ChatResponse>;
}

export interface ConsolidatorOptions {
  contextWindowTokens?: number;
  memoryCompressThreshold?: number;
}

// ====== Constants ======

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MEMORY_COMPRESS_THRESHOLD = 4_000;
const BULK_COMPRESS_TARGET_RATIO = 0.5;
const LOG_MERGE_COUNT = 20;
const LOG_MERGE_TOKENS = 6000;

// 小窗口 → 大窗口的阈值区间
const MIN_WINDOW = 8_192;
const MAX_WINDOW = 1_048_576;
const HARD_TRUNCATE_RANGE = [0.80, 0.95] as const;   // 8K→80%, 1M→95%
const BULK_COMPRESS_RANGE = [0.70, 0.85] as const;    // 8K→70%, 1M→85%

/**
 * 根据上下文窗口大小计算动态阈值比例
 * 对数缩放：小窗口更保守（更早压缩），大窗口更激进（更晚压缩）
 */
export function dynamicRatio(windowTokens: number, range: readonly [number, number]): number {
  const clamped = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, windowTokens));
  const factor = Math.log2(clamped / MIN_WINDOW) / Math.log2(MAX_WINDOW / MIN_WINDOW);
  return range[0] + factor * (range[1] - range[0]);
}

// ====== Consolidator ======

export class Consolidator {
  private contextWindowTokens: number;
  private memoryCompressThreshold: number;

  constructor(
    private db: WorkspaceDB,
    private callLLM: ConsolidatorLLMCall | null,
    options?: ConsolidatorOptions,
  ) {
    this.contextWindowTokens = options?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW;
    this.memoryCompressThreshold = options?.memoryCompressThreshold ?? DEFAULT_MEMORY_COMPRESS_THRESHOLD;
  }

  /** 更新上下文窗口大小（Provider 变更时调用） */
  setContextWindow(tokens: number): void {
    this.contextWindowTokens = tokens;
  }

  /** 获取当前上下文窗口大小 */
  getContextWindow(): number {
    return this.contextWindowTokens;
  }

  /** 检查并按需整合 session 消息 */
  async consolidateIfNeeded(sessionId: string): Promise<boolean> {
    const session = this.db.getSession(sessionId);
    if (!session) return false;

    const messages = this.db.getMessages(sessionId, session.last_consolidated);
    const estimated = estimateMessagesTokens(
      messages.map((m) => ({ role: m.role, content: m.content })),
    );

    // Hard truncation: total token > dynamic threshold → skip LLM, direct archive
    const hardRatio = dynamicRatio(this.contextWindowTokens, HARD_TRUNCATE_RANGE);
    const hardThreshold = this.contextWindowTokens * hardRatio;
    if (estimated > hardThreshold) {
      return this.hardTruncate(messages, sessionId, session.last_consolidated);
    }

    // Bulk compress: unconsolidated tokens > dynamic threshold → 一次性压缩到 50%
    const bulkRatio = dynamicRatio(this.contextWindowTokens, BULK_COMPRESS_RANGE);
    const bulkThreshold = this.contextWindowTokens * bulkRatio;
    if (estimated <= bulkThreshold) return false;

    // 计算需要压缩多少 token 才能降到目标比例以下
    const targetTokens = this.contextWindowTokens * BULK_COMPRESS_TARGET_RATIO;
    const tokensToCompress = estimated - targetTokens;

    // 找到批量压缩边界（对齐到 turn group 边界）
    const boundary = this.pickBoundary(messages, tokensToCompress);
    if (boundary <= 0) return false;

    const chunk = messages.slice(0, boundary);
    const success = await this.consolidateChunk(chunk, sessionId);

    if (success) {
      this.db.updateSession(sessionId, {
        last_consolidated: session.last_consolidated + boundary,
      });

      // After compression, check if log memories need merging
      await this.mergeLogMemoriesIfNeeded();
    }

    return success;
  }

  /** 检查并按需压缩记忆 */
  async compressMemoriesIfNeeded(): Promise<boolean> {
    const tiers = this.db.getMemoriesByTier();
    const mustInject = tiers.mustInject;

    if (mustInject.length === 0) return false;

    const totalTokens = mustInject.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    if (totalTokens <= this.memoryCompressThreshold) return false;

    if (!this.callLLM) {
      // 无 LLM 回调时无法压缩
      return false;
    }

    // 调用 LLM 压缩每条超长记忆
    for (const mem of mustInject) {
      const memTokens = estimateTokens(mem.content);
      if (memTokens <= 500) continue; // 短记忆不压缩

      try {
        const response = await this.callLLM({
          systemPrompt:
            '你是一个记忆压缩助手。请将以下内容压缩为更简洁的版本，保留关键信息和决策要点。输出压缩后的内容，不要添加解释。',
          messages: [{ role: 'user', content: mem.content }],
        });

        if (response.content) {
          this.db.upsertMemory({
            name: mem.name,
            type: mem.type as 'project' | 'reference' | 'decision' | 'feedback' | 'log',
            content: mem.content, // 保留原文
            compressed: 1,
            compressed_content: response.content,
          });
        }
      } catch {
        // 压缩失败不影响主流程
      }
    }

    return true;
  }

  /**
   * 找到第一个 user turn group 的结束位置
   * 一个 turn group = 1 条 user 消息 + 紧跟的 assistant/tool 消息
   */
  findFirstTurnGroupEnd(messages: Message[]): number {
    if (messages.length === 0) return 0;

    // 找到第一条 user 消息
    let i = 0;
    while (i < messages.length && messages[i].role !== 'user') {
      i++;
    }
    if (i >= messages.length) return 0;

    // 跳过 user 消息
    i++;

    // 跳过后续的 assistant/tool 消息
    while (i < messages.length && messages[i].role !== 'user') {
      i++;
    }

    // 不要整合所有消息，至少保留最后 2 条
    const minKeep = 2;
    if (i > messages.length - minKeep) {
      i = Math.max(0, messages.length - minKeep);
    }

    return i;
  }

  /**
   * 找到合适的切割边界（用于 hard truncation）
   * 从头累加 token 直到超过 tokensToRemove，
   * 然后前移到最近的 user 消息起点（避免切断对话对）
   */
  pickBoundary(messages: Message[], tokensToRemove: number): number {
    let accumulated = 0;
    let boundary = 0;

    for (let i = 0; i < messages.length; i++) {
      accumulated += estimateTokens(messages[i].content) + 4; // message overhead
      if (accumulated >= tokensToRemove) {
        boundary = i + 1;
        break;
      }
    }

    if (boundary === 0) return 0;

    // 前移到最近的 user 消息起点（确保不切断 assistant 回复）
    while (boundary < messages.length && messages[boundary].role !== 'user') {
      boundary++;
    }

    // 不要整合所有消息，至少保留最后几条
    const minKeep = 2;
    if (boundary > messages.length - minKeep) {
      boundary = Math.max(0, messages.length - minKeep);
    }

    return boundary;
  }

  /**
   * 硬截断：跳过 LLM，直接将头部消息归档到 log memory
   */
  private async hardTruncate(
    messages: Message[],
    sessionId: string,
    lastConsolidated: number,
  ): Promise<boolean> {
    // 截断到保留目标比例的消息（在批量压缩阈值之下留缓冲）
    const targetRemain = this.contextWindowTokens * BULK_COMPRESS_TARGET_RATIO;
    const estimated = estimateMessagesTokens(
      messages.map((m) => ({ role: m.role, content: m.content })),
    );
    const tokensToRemove = estimated - targetRemain;

    const boundary = this.pickBoundary(messages, tokensToRemove);
    if (boundary <= 0) return false;

    const chunk = messages.slice(0, boundary);
    const chunkText = chunk
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    // 直接归档，不调用 LLM
    this.db.upsertMemory({
      name: `session-${sessionId}-truncate-${Date.now()}`,
      type: 'log',
      content: chunkText.length > 5000 ? chunkText.slice(0, 5000) + '\n...(truncated)' : chunkText,
    });

    this.db.updateSession(sessionId, {
      last_consolidated: lastConsolidated + boundary,
    });

    // After truncation, check if log memories need merging
    await this.mergeLogMemoriesIfNeeded();

    return true;
  }

  /**
   * 检查并合并 log 记忆
   * 当 log 记忆 > LOG_MERGE_COUNT 条 OR 总 token > LOG_MERGE_TOKENS 时触发
   */
  async mergeLogMemoriesIfNeeded(): Promise<boolean> {
    const logMemories = this.db.getMemoriesByType('log');
    if (logMemories.length <= 1) return false;

    const totalTokens = logMemories.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    if (logMemories.length <= LOG_MERGE_COUNT && totalTokens <= LOG_MERGE_TOKENS) {
      return false;
    }

    if (!this.callLLM) {
      // 无 LLM 时无法合并，直接截断最旧的
      const toRemove = logMemories.slice(0, logMemories.length - LOG_MERGE_COUNT);
      for (const mem of toRemove) {
        this.db.deleteMemory(mem.id);
      }
      return toRemove.length > 0;
    }

    // 调用 LLM 合并所有 log 记忆为 1-2 条
    const allContent = logMemories
      .map((m) => m.content)
      .join('\n---\n');

    try {
      const response = await this.callLLM({
        systemPrompt:
          '你是一个记忆合并助手。请将以下多段对话记录合并为 1-2 段精炼的总结，保留关键信息、决策要点和重要上下文。输出合并后的总结，不要添加解释。用 --- 分隔多段总结。',
        messages: [{ role: 'user', content: allContent }],
      });

      if (response.content) {
        // 删除旧 log 记忆
        for (const mem of logMemories) {
          this.db.deleteMemory(mem.id);
        }

        // 写入合并后的 1-2 条
        const summaries = response.content.split('---').map((s) => s.trim()).filter(Boolean);
        for (let i = 0; i < summaries.length; i++) {
          this.db.upsertMemory({
            name: `merged-log-${Date.now()}-${i}`,
            type: 'log',
            content: summaries[i],
          });
        }
        return true;
      }
    } catch {
      // 合并失败不影响主流程
    }

    return false;
  }

  /**
   * 整合消息块到记忆
   * 三级降级：
   * 1. 有 LLM → 调用 LLM 总结后写入记忆
   * 2. LLM 失败 → 直接文本归档
   * 3. 无 LLM → 直接文本归档
   */
  private async consolidateChunk(chunk: Message[], sessionId: string): Promise<boolean> {
    const chunkText = chunk
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    if (this.callLLM) {
      try {
        const response = await this.callLLM({
          systemPrompt:
            '你是一个对话总结助手。请将以下对话内容总结为简洁的要点，保留关键决策、结论和重要信息。输出总结内容，不要添加解释。',
          messages: [{ role: 'user', content: chunkText }],
        });

        if (response.content) {
          this.db.upsertMemory({
            name: `session-${sessionId}-summary-${Date.now()}`,
            type: 'log',
            content: response.content,
          });
          return true;
        }
      } catch {
        // LLM 调用失败，降级到直接归档
      }
    }

    // 降级：直接归档原文
    this.db.upsertMemory({
      name: `session-${sessionId}-archive-${Date.now()}`,
      type: 'log',
      content: chunkText.length > 5000 ? chunkText.slice(0, 5000) + '\n...(truncated)' : chunkText,
    });

    return true;
  }
}
