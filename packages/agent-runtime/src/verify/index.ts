/**
 * Write-Verify-Fix — 工具执行后自动验证
 *
 * 设计原则：
 * - 验证器返回的错误追加到工具结果中，模型在下一轮看到错误后自行修复
 * - 不在验证层重试，让 Agent 循环自然处理（模型能看到完整上下文）
 * - 验证超时视为通过（不因验证慢而阻塞）
 * - 只报与当前修改文件相关的错误（避免存量错误淹没增量问题）
 */

import { logger } from '../logger.js';

// ====== Types ======

export interface VerifyResult {
  passed: boolean;
  errors: string[];
}

/**
 * 验证器函数签名。
 * 在工具执行后调用，检查输出是否合法。
 *
 * @param toolName - 工具名称（write / edit 等）
 * @param input - 工具输入参数
 * @param output - 工具执行的输出结果
 * @returns 验证结果
 */
export type AfterExecVerifier = (
  toolName: string,
  input: Record<string, unknown>,
  output: string,
) => Promise<VerifyResult>;

// ====== VerifierRegistry ======

interface VerifierEntry {
  toolNames: string[];
  verifier: AfterExecVerifier;
}

export class VerifierRegistry {
  private verifiers: VerifierEntry[] = [];

  /**
   * 注册验证器，关联到指定工具。
   * 一个工具可以有多个验证器（全部运行，错误合并）。
   */
  register(toolNames: string[], verifier: AfterExecVerifier): void {
    this.verifiers.push({ toolNames, verifier });
  }

  /**
   * 对指定工具执行所有关联的验证器。
   * 返回合并后的验证结果。
   *
   * 任何验证器超时或抛异常，视为通过（不阻塞工具执行）。
   */
  async verify(
    toolName: string,
    input: Record<string, unknown>,
    output: string,
  ): Promise<VerifyResult> {
    const matched = this.verifiers.filter(
      (v) => v.toolNames.includes(toolName) || v.toolNames.includes('*'),
    );

    if (matched.length === 0) {
      return { passed: true, errors: [] };
    }

    const allErrors: string[] = [];

    for (const entry of matched) {
      try {
        const result = await entry.verifier(toolName, input, output);
        if (!result.passed) {
          allErrors.push(...result.errors);
        }
      } catch (err) {
        // 验证器自身出错，不阻塞工具执行
        logger.warn(`验证器执行异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      passed: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /** 检查指定工具是否有注册的验证器 */
  hasVerifiers(toolName: string): boolean {
    return this.verifiers.some(
      (v) => v.toolNames.includes(toolName) || v.toolNames.includes('*'),
    );
  }
}

/**
 * 将验证错误格式化为追加到工具结果的反馈文本。
 */
export function formatVerifyFeedback(result: VerifyResult): string {
  if (result.passed) return '';
  return [
    '\n\n⚠️ 写入后自动验证失败，请修复以下问题：',
    ...result.errors.map((e, i) => `${i + 1}. ${e}`),
  ].join('\n');
}
