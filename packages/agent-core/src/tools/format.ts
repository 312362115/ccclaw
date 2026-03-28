/**
 * tool-format.ts — 工具格式转换
 *
 * 提供两种模式之间的桥接：
 *   1. toCLIFormat          — 将工具定义转为注入 system prompt 的文本（CLI 模式）
 *   2. parseToolCallsFromText — 从 assistant 文本中解析工具调用
 */

import type { ToolDefinition } from './types.js';

// ====== Types ======

export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
}

// ====== toCLIFormat ======

/**
 * 将工具定义列表转为紧凑的 CLI 风格文本，供注入 system prompt。
 *
 * 每行格式：`<name> <params summary> - <description>`
 * 末尾附上使用说明。
 */
export function toCLIFormat(tools: ToolDefinition[]): string {
  const lines: string[] = ['## Available Tools', ''];

  for (const tool of tools) {
    const paramsSummary = buildParamsSummary(tool);
    const line = paramsSummary
      ? `${tool.name} ${paramsSummary} - ${tool.description}`
      : `${tool.name} - ${tool.description}`;
    lines.push(line);
  }

  lines.push('');
  lines.push('To use a tool, respond with:');
  lines.push('<tool name="tool_name">{"param1": "value1"}</tool>');

  return lines.join('\n');
}

/**
 * 根据 schema 中的 required 字段生成参数摘要。
 * 例如 required: ["command"] => "<command>"
 * 可选参数（不在 required 中）用方括号：[path]
 */
function buildParamsSummary(tool: ToolDefinition): string {
  const schema = tool.schema;
  if (!schema || !schema.properties) return '';

  const required = new Set(schema.required ?? []);
  const parts: string[] = [];

  for (const key of Object.keys(schema.properties)) {
    if (required.has(key)) {
      parts.push(`<${key}>`);
    } else {
      parts.push(`[${key}]`);
    }
  }

  return parts.join(' ');
}

// ====== parseToolCallsFromText ======

/**
 * 从 assistant 文本中解析工具调用。
 *
 * 支持两种格式：
 *   1. XML 格式：  <tool name="bash">{"command": "ls -la"}</tool>
 *   2. JSON block：```tool\n{"name":"bash","input":{"command":"ls"}}\n```
 *
 * 返回空数组表示纯文本响应（无工具调用）。
 * 格式错误的 JSON 会被跳过（不抛出异常）。
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];

  // ---- 格式 1：XML <tool name="...">...</tool> ----
  const xmlRegex = /<tool\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool>/g;
  let match: RegExpExecArray | null;

  while ((match = xmlRegex.exec(text)) !== null) {
    const name = match[1].trim();
    const body = match[2].trim();

    if (!body) continue; // 空体 = 无效

    try {
      const input = JSON.parse(body) as Record<string, unknown>;
      results.push({ name, input });
    } catch {
      // 跳过 JSON 解析失败的调用
    }
  }

  // ---- 格式 2：```tool\n{...}\n``` ----
  const blockRegex = /```tool\n([\s\S]*?)\n```/g;

  while ((match = blockRegex.exec(text)) !== null) {
    const body = match[1].trim();

    try {
      const parsed = JSON.parse(body) as { name?: string; input?: Record<string, unknown> };
      if (typeof parsed.name === 'string' && parsed.input !== undefined) {
        results.push({ name: parsed.name, input: parsed.input });
      }
    } catch {
      // 跳过 JSON 解析失败的调用
    }
  }

  return results;
}
