import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../prompt/composer.js';
import { BASE_SYSTEM_PROMPT } from '../prompt/base.js';
import { assembleSystemPrompt } from '../context/assembler.js';
import type { ToolDefinition } from '../tools/types.js';
import type { ModelProfile } from '../profiles/types.js';

// 测试用工具定义
const sampleTools: ToolDefinition[] = [
  { name: 'read_file', description: '读取文件内容' },
  { name: 'write_file', description: '写入文件内容' },
];

describe('composeSystemPrompt', () => {
  it('用户提示词优先级最高', () => {
    const result = composeSystemPrompt({
      userPrompt: '你是一个代码专家',
      capabilityTier: 3,
      toolDefs: [],
    });
    expect(result).toContain('你是一个代码专家');
    expect(result).not.toContain(BASE_SYSTEM_PROMPT);
  });

  it('未提供用户提示词时使用默认提示词', () => {
    const result = composeSystemPrompt({
      capabilityTier: 3,
      toolDefs: [],
    });
    expect(result).toContain(BASE_SYSTEM_PROMPT);
  });

  it('弱/中等模型（tier 3）注入工具使用指南', () => {
    const result = composeSystemPrompt({
      capabilityTier: 3,
      toolDefs: sampleTools,
      enhancements: { toolUseGuidance: true },
    });
    expect(result).toContain('工具使用指南');
  });

  it('强模型（tier 5）跳过工具使用指南', () => {
    const result = composeSystemPrompt({
      capabilityTier: 5,
      toolDefs: sampleTools,
      enhancements: { toolUseGuidance: true },
    });
    expect(result).not.toContain('工具使用指南');
  });

  it('弱模型（tier 2）注入详细分步指导', () => {
    const result = composeSystemPrompt({
      capabilityTier: 2,
      toolDefs: sampleTools,
      enhancements: { toolUseGuidance: true },
    });
    expect(result).toContain('请严格遵守');
    expect(result).toContain('调用规则');
  });

  it('无工具时不注入工具指南', () => {
    const result = composeSystemPrompt({
      capabilityTier: 2,
      toolDefs: [],
      enhancements: { toolUseGuidance: true },
    });
    expect(result).not.toContain('工具使用指南');
  });

  it('添加工具调用约束', () => {
    const constraints = '每次最多调用 3 个工具';
    const result = composeSystemPrompt({
      capabilityTier: 3,
      toolDefs: sampleTools,
      toolCallConstraints: constraints,
    });
    expect(result).toContain('工具调用约束');
    expect(result).toContain(constraints);
  });
});

describe('assembleSystemPrompt', () => {
  const makeProfile = (
    tier: number,
    maxTokens: number,
    constraints?: string,
  ): ModelProfile => ({
    id: 'test-model',
    displayName: 'Test Model',
    vendor: 'unknown',
    capabilities: {
      contextWindow: 32_000,
      maxOutputTokens: 4096,
      toolUse: false,
      extendedThinking: false,
      vision: false,
      promptCaching: false,
      jsonMode: false,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 4096 },
    promptStrategy: {
      maxSystemPromptTokens: maxTokens,
      toolCallConstraints: constraints,
      needsToolExamples: false,
      preferPhasedPrompt: false,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: false,
      benefitsFromAutoPlan: false,
      benefitsFromReview: false,
    },
    routing: {
      roles: ['primary'],
      costEfficiency: 3,
      capabilityTier: tier,
    },
  });

  it('正常组装不截断', () => {
    const result = assembleSystemPrompt({
      userPrompt: '短提示词',
      profile: makeProfile(3, 10000),
      toolDefs: sampleTools,
    });
    expect(result).toContain('短提示词');
  });

  it('超出 token 上限时截断', () => {
    // maxTokens=5 → maxChars=20，"短提示词" 是 3 个汉字（9字节 UTF-8 但 length=3）
    // 用一个足够长的提示词触发截断
    const longPrompt = '这是一个非常长的提示词'.repeat(100);
    const result = assembleSystemPrompt({
      userPrompt: longPrompt,
      profile: makeProfile(3, 10),
      toolDefs: [],
    });
    // 10 tokens * 4 chars = 40 chars 上限
    expect(result.length).toBeLessThanOrEqual(40);
  });

  it('透传 profile 中的 toolCallConstraints', () => {
    const result = assembleSystemPrompt({
      profile: makeProfile(3, 10000, '禁止并行调用工具'),
      toolDefs: sampleTools,
      enhancements: { toolUseGuidance: true },
    });
    expect(result).toContain('禁止并行调用工具');
  });
});
