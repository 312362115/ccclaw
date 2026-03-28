import { describe, it, expect, vi } from 'vitest';
import { Evaluator } from '../harness/evaluator.js';
import type { EvaluatorConfig, EvalCriterion } from '../harness/evaluator.js';
import type { LLMProvider, LLMStreamEvent, ChatParams } from '../providers/types.js';

// ============================================================
// 辅助工具
// ============================================================

/** 创建一个 mock provider，返回指定的文本内容 */
function createMockProvider(responseText: string): LLMProvider {
  return {
    capabilities: () => ({
      streaming: true,
      toolUse: false,
      extendedThinking: false,
      vision: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    }),
    stream: (_params: ChatParams) => {
      // 用 AsyncGenerator 模拟 stream
      async function* generate(): AsyncIterable<LLMStreamEvent> {
        yield { type: 'text_delta', delta: responseText };
        yield { type: 'done', stopReason: 'end_turn' };
      }
      return generate();
    },
  };
}

const DEFAULT_CRITERIA: EvalCriterion[] = [
  { name: '完整性', description: '内容是否完整覆盖了需求', weight: 8 },
  { name: '准确性', description: '内容是否准确无误', weight: 7 },
  { name: '可读性', description: '内容是否易于理解', weight: 5 },
];

function makeConfig(
  responseText: string,
  overrides?: Partial<EvaluatorConfig>,
): EvaluatorConfig {
  return {
    provider: createMockProvider(responseText),
    model: 'test-model',
    criteria: DEFAULT_CRITERIA,
    ...overrides,
  };
}

// ============================================================
// 测试
// ============================================================

describe('Evaluator', () => {
  describe('构造与配置', () => {
    it('使用默认阈值和最大 token 数正确构造', () => {
      const evaluator = new Evaluator(makeConfig('{}'));
      expect(evaluator).toBeDefined();
    });

    it('接受自定义阈值', () => {
      const evaluator = new Evaluator(makeConfig('{}', { threshold: 85 }));
      expect(evaluator).toBeDefined();
    });
  });

  describe('提示词构建', () => {
    it('包含所有评审标准', () => {
      const evaluator = new Evaluator(makeConfig('{}'));
      const prompt = evaluator.buildPrompt('待评审内容');

      expect(prompt).toContain('完整性');
      expect(prompt).toContain('准确性');
      expect(prompt).toContain('可读性');
      expect(prompt).toContain('权重: 8/10');
      expect(prompt).toContain('权重: 7/10');
      expect(prompt).toContain('权重: 5/10');
    });

    it('包含待评审内容', () => {
      const evaluator = new Evaluator(makeConfig('{}'));
      const prompt = evaluator.buildPrompt('这是需要评审的内容');
      expect(prompt).toContain('这是需要评审的内容');
    });

    it('包含上下文信息（当提供时）', () => {
      const evaluator = new Evaluator(makeConfig('{}'));
      const prompt = evaluator.buildPrompt('内容', '这是背景信息');
      expect(prompt).toContain('背景信息');
      expect(prompt).toContain('这是背景信息');
    });

    it('不包含上下文块（当未提供时）', () => {
      const evaluator = new Evaluator(makeConfig('{}'));
      const prompt = evaluator.buildPrompt('内容');
      expect(prompt).not.toContain('## 背景信息');
    });

    it('使用默认权重 5（当标准未指定权重时）', () => {
      const evaluator = new Evaluator(
        makeConfig('{}', {
          criteria: [{ name: '测试标准', description: '无权重标准' }],
        }),
      );
      const prompt = evaluator.buildPrompt('内容');
      expect(prompt).toContain('权重: 5/10');
    });
  });

  describe('JSON 响应解析', () => {
    it('正确解析有效的 JSON 响应', () => {
      const validJson = JSON.stringify({
        criteria: [
          { name: '完整性', passed: true, score: 90, reason: '内容完整' },
          { name: '准确性', passed: true, score: 85, reason: '准确无误' },
          { name: '可读性', passed: true, score: 80, reason: '易于理解' },
        ],
        summary: '整体质量良好',
        suggestions: ['可以增加示例'],
      });

      const evaluator = new Evaluator(makeConfig(validJson));
      const result = evaluator.parseResponse(validJson);

      expect(result.criteria).toHaveLength(3);
      expect(result.criteria[0].score).toBe(90);
      expect(result.criteria[1].score).toBe(85);
      expect(result.criteria[2].score).toBe(80);
      expect(result.summary).toBe('整体质量良好');
      expect(result.suggestions).toEqual(['可以增加示例']);
    });

    it('根据加权分数计算 overallScore', () => {
      const json = JSON.stringify({
        criteria: [
          { name: '完整性', score: 100, reason: '' },
          { name: '准确性', score: 50, reason: '' },
          { name: '可读性', score: 80, reason: '' },
        ],
        summary: '',
        suggestions: [],
      });

      const evaluator = new Evaluator(makeConfig(json));
      const result = evaluator.parseResponse(json);

      // 加权计算: (100*8 + 50*7 + 80*5) / (8+7+5) = (800+350+400)/20 = 77.5 → 78
      expect(result.overallScore).toBe(78);
    });

    it('阈值 70 时 overallScore >= 70 应 approved', () => {
      const json = JSON.stringify({
        criteria: [
          { name: '完整性', score: 80, reason: '' },
          { name: '准确性', score: 80, reason: '' },
          { name: '可读性', score: 80, reason: '' },
        ],
        summary: '',
        suggestions: [],
      });

      const evaluator = new Evaluator(makeConfig(json));
      const result = evaluator.parseResponse(json);

      expect(result.overallScore).toBe(80);
      expect(result.approved).toBe(true);
    });

    it('阈值 70 时 overallScore < 70 应 rejected', () => {
      const json = JSON.stringify({
        criteria: [
          { name: '完整性', score: 50, reason: '' },
          { name: '准确性', score: 50, reason: '' },
          { name: '可读性', score: 50, reason: '' },
        ],
        summary: '',
        suggestions: [],
      });

      const evaluator = new Evaluator(makeConfig(json));
      const result = evaluator.parseResponse(json);

      expect(result.overallScore).toBe(50);
      expect(result.approved).toBe(false);
    });

    it('解析包含 markdown 代码块的 JSON', () => {
      const wrapped = '```json\n' + JSON.stringify({
        criteria: [
          { name: '完整性', score: 90, reason: '好' },
          { name: '准确性', score: 85, reason: '好' },
          { name: '可读性', score: 80, reason: '好' },
        ],
        summary: '不错',
        suggestions: [],
      }) + '\n```';

      const evaluator = new Evaluator(makeConfig(wrapped));
      const result = evaluator.parseResponse(wrapped);

      expect(result.criteria).toHaveLength(3);
      expect(result.criteria[0].score).toBe(90);
    });

    it('使用配置中的标准名称覆盖响应中的名称', () => {
      const json = JSON.stringify({
        criteria: [
          { name: 'completeness', score: 90, reason: '好' },
          { name: 'accuracy', score: 85, reason: '好' },
          { name: 'readability', score: 80, reason: '好' },
        ],
        summary: '',
        suggestions: [],
      });

      const evaluator = new Evaluator(makeConfig(json));
      const result = evaluator.parseResponse(json);

      // 名称应来自配置而非响应
      expect(result.criteria[0].name).toBe('完整性');
      expect(result.criteria[1].name).toBe('准确性');
      expect(result.criteria[2].name).toBe('可读性');
    });
  });

  describe('异常响应处理', () => {
    it('完全无法解析时返回低分结果', () => {
      const evaluator = new Evaluator(makeConfig('这不是 JSON'));
      const result = evaluator.parseResponse('这不是有效的响应');

      expect(result.approved).toBe(false);
      expect(result.overallScore).toBe(0);
      expect(result.criteria).toHaveLength(3);
      expect(result.criteria.every((c) => c.score === 0)).toBe(true);
    });

    it('空字符串返回低分结果', () => {
      const evaluator = new Evaluator(makeConfig(''));
      const result = evaluator.parseResponse('');

      expect(result.approved).toBe(false);
      expect(result.overallScore).toBe(0);
    });

    it('score 超出范围时被 clamp 到 [0, 100]', () => {
      const json = JSON.stringify({
        criteria: [
          { name: '完整性', score: 150, reason: '' },
          { name: '准确性', score: -20, reason: '' },
          { name: '可读性', score: 80, reason: '' },
        ],
        summary: '',
        suggestions: [],
      });

      const evaluator = new Evaluator(makeConfig(json));
      const result = evaluator.parseResponse(json);

      expect(result.criteria[0].score).toBe(100);
      expect(result.criteria[1].score).toBe(0);
      expect(result.criteria[2].score).toBe(80);
    });
  });

  describe('evaluate() 集成（mock provider）', () => {
    it('调用 provider 并返回解析后的 EvalResult', async () => {
      const responseJson = JSON.stringify({
        criteria: [
          { name: '完整性', passed: true, score: 88, reason: '内容完整' },
          { name: '准确性', passed: true, score: 92, reason: '准确' },
          { name: '可读性', passed: true, score: 75, reason: '可读' },
        ],
        summary: '质量良好',
        suggestions: ['增加注释'],
      });

      const evaluator = new Evaluator(makeConfig(responseJson));
      const result = await evaluator.evaluate('测试内容');

      expect(result.approved).toBe(true);
      expect(result.criteria).toHaveLength(3);
      expect(result.summary).toBe('质量良好');
      expect(result.suggestions).toEqual(['增加注释']);
    });

    it('provider 调用使用正确的参数', async () => {
      const streamSpy = vi.fn();
      const mockProvider: LLMProvider = {
        capabilities: () => ({
          streaming: true,
          toolUse: false,
          extendedThinking: false,
          vision: false,
          contextWindow: 128000,
          maxOutputTokens: 4096,
        }),
        stream: (params: ChatParams) => {
          streamSpy(params);
          async function* generate(): AsyncIterable<LLMStreamEvent> {
            yield {
              type: 'text_delta',
              delta: JSON.stringify({
                criteria: [{ name: '测试', score: 80, reason: 'ok' }],
                summary: 'ok',
                suggestions: [],
              }),
            };
            yield { type: 'done', stopReason: 'end_turn' };
          }
          return generate();
        },
      };

      const evaluator = new Evaluator({
        provider: mockProvider,
        model: 'eval-model',
        criteria: [{ name: '测试', description: '测试标准' }],
        threshold: 75,
        maxTokens: 2048,
      });

      await evaluator.evaluate('待评审内容', '上下文');

      expect(streamSpy).toHaveBeenCalledOnce();
      const params = streamSpy.mock.calls[0][0] as ChatParams;
      expect(params.model).toBe('eval-model');
      expect(params.maxTokens).toBe(2048);
      expect(params.temperature).toBe(0.1);
      expect(params.responseFormat).toEqual({ type: 'json_object' });
      // 提示词中应包含评审内容和上下文
      const userContent = params.messages[0].content as string;
      expect(userContent).toContain('待评审内容');
      expect(userContent).toContain('上下文');
    });
  });
});
