/**
 * Consolidator — Token 驱动的上下文整合
 *
 * 当 session 消息 token 超过上下文窗口 50% 时触发整合：
 * 1. 从头部切割消息块
 * 2. 三级降级策略归档到记忆
 * 3. 更新 lastConsolidated 偏移
 *
 * 记忆压缩：当 decision + feedback 总 token 超过阈值时，
 * 调用 LLM 合并压缩。
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
const CONSOLIDATION_THRESHOLD_RATIO = 0.5;
const TARGET_RATIO = 0.3; // 整合后目标：保留 30% 窗口的消息

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

  /** 检查并按需整合 session 消息 */
  async consolidateIfNeeded(sessionId: string): Promise<boolean> {
    const session = this.db.getSession(sessionId);
    if (!session) return false;

    const messages = this.db.getMessages(sessionId, session.last_consolidated);
    const estimated = estimateMessagesTokens(
      messages.map((m) => ({ role: m.role, content: m.content })),
    );
    const threshold = this.contextWindowTokens * CONSOLIDATION_THRESHOLD_RATIO;

    if (estimated <= threshold) return false;

    const targetRemove = estimated - this.contextWindowTokens * TARGET_RATIO;
    const boundary = this.pickBoundary(messages, targetRemove);

    if (boundary <= 0) return false;

    const chunk = messages.slice(0, boundary);
    const success = await this.consolidateChunk(chunk, sessionId);

    if (success) {
      this.db.updateSession(sessionId, {
        last_consolidated: session.last_consolidated + boundary,
      });
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
   * 找到合适的切割边界
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
