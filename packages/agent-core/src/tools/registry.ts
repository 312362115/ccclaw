/**
 * ToolRegistry — 简化版工具注册表
 *
 * 提供工具的注册、查询、执行接口。
 * 相比 agent-runtime 版本，去掉了 MCP、Hook、Verifier、受限模式等。
 */

import type { Tool, ToolDefinition, ToolSchema } from './types.js';

// ====== Constants ======

const MAX_TOOL_RESULT_CHARS = 16_000;

// ====== ToolRegistry ======

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** 注册一个工具 */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** 注销工具 */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 检查工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 获取所有工具定义（用于 LLM） */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, schema }) => ({
      name,
      description,
      schema,
    }));
  }

  /** 获取工具名列表 */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** 获取工具数量 */
  get size(): number {
    return this.tools.size;
  }

  /** 执行工具，返回结果字符串（不抛异常） */
  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Unknown tool "${name}"\n\nAvailable tools: ${this.getToolNames().join(', ')}`;
    }

    try {
      const casted = tool.schema ? castParams(input, tool.schema) : input;
      let result = await tool.execute(casted);

      if (result.length > MAX_TOOL_RESULT_CHARS) {
        result = result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...(truncated)';
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
}

// ====== Parameter Casting ======

/**
 * 根据 schema 将 LLM 传来的字符串参数转换为正确类型。
 * LLM 有时会将 number/boolean 以字符串形式传递。
 */
export function castParams(
  params: Record<string, unknown>,
  schema: ToolSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params };

  for (const [key, def] of Object.entries(schema.properties)) {
    if (!(key in result)) continue;
    const val = result[key];
    if (val === undefined || val === null) continue;

    switch (def.type) {
      case 'number':
      case 'integer':
        if (typeof val === 'string') {
          const num = Number(val);
          if (!Number.isNaN(num)) result[key] = num;
        }
        break;
      case 'boolean':
        if (typeof val === 'string') {
          if (val === 'true') result[key] = true;
          else if (val === 'false') result[key] = false;
        }
        break;
      case 'array':
      case 'object':
        if (typeof val === 'string') {
          try { result[key] = JSON.parse(val); } catch { /* 保持原值 */ }
        }
        break;
    }
  }

  return result;
}
