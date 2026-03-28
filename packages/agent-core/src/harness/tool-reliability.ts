/**
 * Tool Reliability — 工具调用可靠性追踪与配置
 *
 * 提供：
 *   1. ToolReliabilityConfig — 可靠性增强开关
 *   2. ToolReliabilityTracker — 工具调用指标收集
 */

// ============================================================
// Config
// ============================================================

export interface ToolReliabilityConfig {
  /** L2: 启用模糊 JSON 修复（repairJson） */
  fuzzyJsonRepair: boolean;
  /** L3: 解析失败时注入纠错提示让 LLM 重试 */
  retryOnParseError: boolean;
  /** L3: 最大重试次数（medium 默认 1，heavy 默认 2） */
  maxRetries: number;
  /** L4: 启用调用指标收集 */
  metrics: boolean;
}

/** 默认配置：全部启用，重试 1 次 */
export const DEFAULT_TOOL_RELIABILITY_CONFIG: ToolReliabilityConfig = {
  fuzzyJsonRepair: true,
  retryOnParseError: true,
  maxRetries: 1,
  metrics: true,
};

// ============================================================
// Metrics
// ============================================================

export interface ToolMetrics {
  totalCalls: number;
  successfulCalls: number;
  parseErrors: number;
  retriedCalls: number;
  byTool: Record<string, { total: number; errors: number }>;
}

function createEmptyMetrics(): ToolMetrics {
  return {
    totalCalls: 0,
    successfulCalls: 0,
    parseErrors: 0,
    retriedCalls: 0,
    byTool: {},
  };
}

// ============================================================
// Tracker
// ============================================================

export class ToolReliabilityTracker {
  private metrics: ToolMetrics;

  constructor() {
    this.metrics = createEmptyMetrics();
  }

  /** 记录一次工具调用（成功或失败） */
  recordCall(toolName: string, success: boolean): void {
    this.metrics.totalCalls++;

    if (success) {
      this.metrics.successfulCalls++;
    }

    if (!this.metrics.byTool[toolName]) {
      this.metrics.byTool[toolName] = { total: 0, errors: 0 };
    }
    this.metrics.byTool[toolName].total++;

    if (!success) {
      this.metrics.byTool[toolName].errors++;
    }
  }

  /** 记录一次解析错误 */
  recordParseError(): void {
    this.metrics.parseErrors++;
  }

  /** 记录一次重试 */
  recordRetry(): void {
    this.metrics.retriedCalls++;
  }

  /** 获取当前指标快照 */
  getMetrics(): ToolMetrics {
    return {
      ...this.metrics,
      byTool: { ...this.metrics.byTool },
    };
  }

  /** 重置所有指标 */
  reset(): void {
    this.metrics = createEmptyMetrics();
  }
}
