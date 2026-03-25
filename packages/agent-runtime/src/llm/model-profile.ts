/**
 * ModelProfile — 描述一个具体模型的能力和最优参数
 *
 * 设计原则：
 * - Profile 是纯数据（声明式），不包含逻辑
 * - 一个模型一份 Profile，新模型只需新增 Profile 对象
 * - Agent/Provider/ContextAssembler 读取 Profile 来适配行为
 *
 * 新模型适配流程：
 * 1. 在 profiles/<vendor>.ts 中新增 ModelProfile 对象
 * 2. 运行评测基准验证效果
 * 3. 根据评测结果微调 Profile 参数
 */

// ====== ModelProfile 接口 ======

export interface ModelProfile {
  /** 模型 ID，用于匹配。支持精确匹配和前缀匹配（如 'claude-opus-4' 匹配 'claude-opus-4-20250514'） */
  id: string;

  /** 人类可读名称 */
  displayName: string;

  /** 模型厂商 */
  vendor: ModelVendor;

  /** 能力声明 */
  capabilities: ModelCapabilities;

  /** 默认参数 */
  defaults: ModelDefaults;

  /** 按阶段覆盖默认参数 */
  overrides?: Partial<Record<AgentPhase, Partial<ModelDefaults>>>;

  /** Prompt 适配策略 */
  promptStrategy: PromptStrategy;

  /** 执行策略（驱动 Agent 行为） */
  executionStrategy: ExecutionStrategy;

  /** 模型路由信息（可选，无路由需求的场景可不填） */
  routing?: ModelRouting;
}

// ====== 子类型 ======

export type ModelVendor = 'anthropic' | 'openai' | 'google' | 'alibaba' | 'deepseek' | (string & {});

export type AgentPhase = 'planning' | 'coding' | 'reviewing';

export interface ModelCapabilities {
  /** token 上限 */
  contextWindow: number;
  /** 单次输出上限 */
  maxOutputTokens: number;
  /** 是否支持原生 function calling */
  toolUse: boolean;
  /** 是否支持 thinking/reasoning 输出 */
  extendedThinking: boolean;
  /** 是否支持图片输入 */
  vision: boolean;
  /** 是否支持 prefix caching */
  promptCaching: boolean;
  /** 是否支持 response_format: json_object */
  jsonMode: boolean;
  /** 是否能可靠地并行调用多个工具 */
  parallelToolCalls: boolean;
}

export interface ModelDefaults {
  temperature: number;
  maxTokens: number;
}

export interface PromptStrategy {
  /**
   * system prompt 最大建议长度（token）。
   * 超过此长度对该模型效果显著下降。
   * ContextAssembler 据此裁剪。
   */
  maxSystemPromptTokens: number;

  /**
   * 模型专属的工具调用约束规则。
   * 注入到 system prompt 末尾。
   * 强模型可不设置（undefined），弱模型按需配置。
   */
  toolCallConstraints?: string;

  /**
   * 工具描述是否需要 few-shot 示例。
   * 强模型不需要，弱模型需要。
   */
  needsToolExamples: boolean;

  /**
   * 是否倾向于分阶段 prompt（planning/coding/reviewing 各用不同 prompt）。
   * 弱模型受益明显，强模型无所谓。
   */
  preferPhasedPrompt: boolean;

  /**
   * 自定义 prompt 片段，会被插入到 system prompt 末尾。
   * 用于模型特有的提示词。
   */
  customPromptSuffix?: string;
}

export interface ExecutionStrategy {
  /**
   * 建议的单次最大工具调用数。
   * 1 = 串行（弱模型更安全），>1 = 允许并行（强模型效率高）。
   */
  maxConcurrentToolCalls: number;

  /** Write-Verify-Fix 循环是否对该模型有价值 */
  benefitsFromVerifyFix: boolean;

  /** 是否建议对复杂任务自动 Plan 拆解 */
  benefitsFromAutoPlan: boolean;

  /** 是否建议启用 Reviewer Agent 双重检查 */
  benefitsFromReview: boolean;
}

export type ModelRole = 'primary' | 'planning' | 'coding' | 'review' | 'subagent';

export interface ModelRouting {
  /** 该模型适合的任务角色 */
  roles: ModelRole[];

  /** 性价比评级（1-5）。5=最便宜，1=最贵。用于同角色多模型间选择 */
  costEfficiency: number;

  /** 能力评级（1-5）。5=顶级，1=基础。 */
  capabilityTier: number;
}
