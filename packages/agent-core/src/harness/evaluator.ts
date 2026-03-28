/**
 * 独立质量评审者（Independent Evaluator）
 *
 * 核心设计理念（来自 Anthropic Harness 设计发现）：
 * "Models asked to evaluate their own work tend to confidently praise it
 *  — even when obviously mediocre."
 *
 * 因此评审必须由独立的 LLM 调用完成，与生成内容的模型调用分离。
 * 评审者基于可配置的评审标准（EvalCriterion）逐项打分，给出结构化评审结果。
 */

import type { LLMProvider, LLMStreamEvent } from '../providers/types.js';

// ============================================================
// 类型定义
// ============================================================

/** 单个评审标准 */
export interface EvalCriterion {
  name: string;
  description: string;
  /** 权重 1-10，默认 5 */
  weight?: number;
}

/** 单个标准的评审结果 */
export interface CriterionResult {
  name: string;
  passed: boolean;
  score: number; // 0-100
  reason: string;
}

/** 完整评审结果 */
export interface EvalResult {
  approved: boolean;
  overallScore: number; // 0-100
  criteria: CriterionResult[];
  summary: string;
  suggestions: string[];
}

/** Evaluator 配置 */
export interface EvaluatorConfig {
  provider: LLMProvider;
  model: string;
  criteria: EvalCriterion[];
  /** 最低通过分数（默认 70） */
  threshold?: number;
  /** 评审响应最大 token 数 */
  maxTokens?: number;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_THRESHOLD = 70;
const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// Evaluator
// ============================================================

export class Evaluator {
  private readonly threshold: number;
  private readonly maxTokens: number;

  constructor(private readonly config: EvaluatorConfig) {
    this.threshold = config.threshold ?? DEFAULT_THRESHOLD;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * 构建评审提示词（内部方法，暴露给测试用）
   */
  buildPrompt(content: string, context?: string): string {
    const criteriaBlock = this.config.criteria
      .map((c, i) => {
        const weight = c.weight ?? 5;
        return `${i + 1}. **${c.name}**（权重: ${weight}/10）: ${c.description}`;
      })
      .join('\n');

    const contextBlock = context
      ? `\n## 背景信息\n\n${context}\n`
      : '';

    return `你是一位独立质量评审者。你的职责是根据给定的评审标准，客观、严格地评估以下内容的质量。

**重要**：你必须保持独立客观，不要因为内容看起来"还行"就给高分。严格按照每个标准的描述来评判。

## 评审标准

${criteriaBlock}
${contextBlock}
## 待评审内容

\`\`\`
${content}
\`\`\`

## 输出要求

请以严格的 JSON 格式返回评审结果，不要包含任何其他文本，不要用 markdown 代码块包裹：

{
  "criteria": [
    {
      "name": "标准名称",
      "passed": true,
      "score": 85,
      "reason": "评分理由"
    }
  ],
  "summary": "整体评价摘要",
  "suggestions": ["改进建议1", "改进建议2"]
}

要求：
- criteria 数组必须包含每个评审标准的结果，顺序与上述标准一致
- score 范围 0-100，passed 为 score >= 60
- summary 用一两句话概括整体质量
- suggestions 列出具体可操作的改进建议，没有则为空数组`;
  }

  /**
   * 执行评审
   */
  async evaluate(content: string, context?: string): Promise<EvalResult> {
    const prompt = this.buildPrompt(content, context);

    // 通过 stream 接口收集完整响应（provider 只暴露 stream）
    const fullText = await this.collectResponse(prompt);

    // 解析响应
    return this.parseResponse(fullText);
  }

  /**
   * 从 stream 中收集完整文本响应
   */
  private async collectResponse(prompt: string): Promise<string> {
    const stream = this.config.provider.stream({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一位严格的独立质量评审者。只返回 JSON 格式的评审结果，不要包含任何其他文本。',
      maxTokens: this.maxTokens,
      temperature: 0.1, // 低温度保证评审一致性
      responseFormat: { type: 'json_object' },
    });

    let text = '';
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        text += event.delta;
      }
    }
    return text;
  }

  /**
   * 解析 LLM 返回的评审结果。
   * 优先尝试 JSON 解析，失败时使用正则提取作为降级。
   */
  parseResponse(text: string): EvalResult {
    // 尝试 JSON 解析
    const jsonResult = this.tryParseJson(text);
    if (jsonResult) return jsonResult;

    // 降级：正则提取
    const regexResult = this.tryParseRegex(text);
    if (regexResult) return regexResult;

    // 完全无法解析 — 返回低分结果
    return this.failedParseResult('评审响应无法解析');
  }

  private tryParseJson(text: string): EvalResult | null {
    try {
      // 尝试直接解析
      let parsed = this.safeParse(text);

      // 如果直接解析失败，尝试从 markdown 代码块中提取
      if (!parsed) {
        const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
          parsed = this.safeParse(codeBlockMatch[1]);
        }
      }

      if (!parsed || !Array.isArray(parsed.criteria)) {
        return null;
      }

      const criteria: CriterionResult[] = parsed.criteria.map(
        (c: Record<string, unknown>, i: number) => {
          const expectedName = this.config.criteria[i]?.name ?? String(c.name ?? `标准${i + 1}`);
          const score = clamp(Number(c.score) || 0, 0, 100);
          return {
            name: expectedName,
            passed: score >= 60,
            score,
            reason: String(c.reason ?? ''),
          };
        },
      );

      const overallScore = this.calculateOverallScore(criteria);

      return {
        approved: overallScore >= this.threshold,
        overallScore,
        criteria,
        summary: String(parsed.summary ?? ''),
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.map(String)
          : [],
      };
    } catch {
      return null;
    }
  }

  private safeParse(text: string): Record<string, unknown> | null {
    try {
      const result = JSON.parse(text.trim());
      return typeof result === 'object' && result !== null ? result : null;
    } catch {
      return null;
    }
  }

  private tryParseRegex(text: string): EvalResult | null {
    // 尝试提取分数模式：name: score 或 name - score
    const scorePattern = /["']?(\w[\w\s]*?)["']?\s*[:：-]\s*(\d{1,3})/g;
    const matches = [...text.matchAll(scorePattern)];

    if (matches.length === 0) return null;

    const criteria: CriterionResult[] = this.config.criteria.map((criterion, i) => {
      const match = matches[i];
      const score = match ? clamp(Number(match[2]), 0, 100) : 0;
      return {
        name: criterion.name,
        passed: score >= 60,
        score,
        reason: '从非结构化响应中提取',
      };
    });

    const overallScore = this.calculateOverallScore(criteria);

    return {
      approved: overallScore >= this.threshold,
      overallScore,
      criteria,
      summary: '评审结果从非结构化响应中提取，可靠性较低',
      suggestions: ['建议重新运行评审以获取更可靠的结果'],
    };
  }

  private failedParseResult(reason: string): EvalResult {
    return {
      approved: false,
      overallScore: 0,
      criteria: this.config.criteria.map((c) => ({
        name: c.name,
        passed: false,
        score: 0,
        reason,
      })),
      summary: reason,
      suggestions: ['评审过程出现异常，建议重试'],
    };
  }

  /**
   * 根据权重计算加权总分
   */
  private calculateOverallScore(criteria: CriterionResult[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < criteria.length; i++) {
      const weight = this.config.criteria[i]?.weight ?? 5;
      totalWeight += weight;
      weightedSum += criteria[i].score * weight;
    }

    if (totalWeight === 0) return 0;
    return Math.round(weightedSum / totalWeight);
  }
}

/** 将数值限制在 [min, max] 范围内 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
