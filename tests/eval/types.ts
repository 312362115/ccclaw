/**
 * 评测基准类型定义
 */

export type Difficulty = 'simple' | 'medium' | 'complex';

export type AcceptanceCheckType =
  | 'file_contains'      // 文件包含指定内容
  | 'file_not_contains'  // 文件不包含指定内容
  | 'file_exists'        // 文件存在
  | 'compile_pass'       // 编译通过
  | 'command_success'    // 命令执行成功（exit code 0）
  | 'output_contains';   // 命令输出包含指定内容

export interface AcceptanceCheck {
  type: AcceptanceCheckType;
  /** 目标文件（file_contains / file_not_contains / file_exists） */
  file?: string;
  /** 匹配模式（正则字符串） */
  pattern?: string;
  /** 执行命令（compile_pass / command_success / output_contains） */
  command?: string;
}

export interface EvalCase {
  id: string;
  name: string;
  difficulty: Difficulty;
  /** 发送给 Agent 的需求描述 */
  description: string;
  /** 初始代码库路径（相对于 fixtures/） */
  fixture: string;
  /** 验收条件 */
  acceptance: AcceptanceCheck[];
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  difficulty: Difficulty;
  /** 首次是否通过 */
  firstPassSuccess: boolean;
  /** 最终是否通过（含重试） */
  finalSuccess: boolean;
  /** 完成所用轮次 */
  iterations: number;
  /** 耗时毫秒 */
  durationMs: number;
  /** Token 消耗 */
  inputTokens: number;
  outputTokens: number;
  /** 失败的检查项 */
  failedChecks: string[];
}

export interface EvalReport {
  provider: string;
  model: string;
  timestamp: string;
  results: EvalResult[];
  summary: EvalSummary;
}

export interface EvalSummary {
  total: number;
  firstPassRate: number;
  finalPassRate: number;
  avgIterations: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byDifficulty: Record<Difficulty, {
    total: number;
    firstPassRate: number;
    finalPassRate: number;
  }>;
}
