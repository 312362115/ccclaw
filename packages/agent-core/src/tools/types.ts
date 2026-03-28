// ============================================================
// Tool types — 工具定义与执行接口
// ============================================================

/** 工具参数 schema（JSON Schema 子集） */
export interface ToolSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }
  >;
  required?: string[];
}

/** 可执行工具 */
export interface Tool {
  name: string;
  description: string;
  schema?: ToolSchema;
  execute(input: Record<string, unknown>): Promise<string>;
}

/** 工具定义（不含执行逻辑，用于注册和传递给 LLM） */
export interface ToolDefinition {
  name: string;
  description: string;
  schema?: ToolSchema;
}
