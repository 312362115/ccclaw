/**
 * Planning System — 类型定义
 *
 * Plan 是结构化的任务拆解结果，由 LLM 生成，供 Agent 逐步执行。
 */

export interface PlanStep {
  step: number;
  description: string;
  files: string[];
  action: 'create' | 'modify' | 'delete' | 'verify';
  detail: string;
  dependsOn: number[];
}

export interface Plan {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  steps: PlanStep[];
}

export interface StepResult {
  stepIndex: number;
  success: boolean;
  summary: string;
}
