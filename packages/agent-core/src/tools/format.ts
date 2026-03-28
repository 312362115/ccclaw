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

// ====== repairJson ======

/**
 * 尝试修复弱模型常见的 JSON 格式问题。
 *
 * 修复策略（按顺序）：
 *   1. 剥离 markdown 包裹
 *   2. 移除 JS 风格注释（块注释和行注释）
 *   3. 将单引号替换为双引号（仅在字符串边界处）
 *   4. 给未加引号的 key 补上双引号
 *   5. 移除尾逗号
 *
 * 如果输入本身就是合法 JSON，直接返回原文。
 * 如果修复后仍不合法，返回原文（让调用方处理错误）。
 */
export function repairJson(text: string): string {
  // 先试一下原文是否合法
  try {
    JSON.parse(text);
    return text;
  } catch {
    // 需要修复
  }

  let repaired = text;

  // 1. 剥离 markdown 包裹: ```json ... ``` 或 ``` ... ```
  repaired = repaired.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m, '$1').trim();

  // 2. 移除 JS 注释
  //    块注释 /* ... */
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
  //    行注释 // ...（但不能误删 JSON 字符串内的 :// ）
  //    只移除不在双引号字符串内的行注释
  repaired = repaired.replace(/(?<=^|[^":])\s*\/\/[^\n]*/g, '');

  // 3. 单引号 → 双引号
  //    简单策略：将充当字符串定界符的单引号替换为双引号
  //    匹配模式：key 位置的 'xxx' 和 value 位置的 'xxx'
  repaired = repaired.replace(
    /(?<=[\[{,:\s])'/g, '"',
  ).replace(
    /'(?=\s*[,\]}\n:])/g, '"',
  );

  // 4. 给未加引号的 key 补双引号
  //    匹配 { key: 或 , key: 中没有引号的 key
  repaired = repaired.replace(
    /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
    '$1"$2":',
  );

  // 5. 移除尾逗号（对象和数组中最后一个元素后的逗号）
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  return repaired;
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
 * 格式错误的 JSON 会先尝试 repairJson 修复，仍失败则跳过。
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

    const input = tryParseJson(body);
    if (input !== null) {
      results.push({ name, input });
    }
  }

  // ---- 格式 2：```tool\n{...}\n``` ----
  const blockRegex = /```tool\n([\s\S]*?)\n```/g;

  while ((match = blockRegex.exec(text)) !== null) {
    const body = match[1].trim();

    const parsed = tryParseJson(body);
    if (
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).name === 'string' &&
      (parsed as Record<string, unknown>).input !== undefined
    ) {
      const obj = parsed as { name: string; input: Record<string, unknown> };
      results.push({ name: obj.name, input: obj.input });
    }
  }

  return results;
}

/**
 * 辅助函数：先直接 parse，失败则 repairJson 后再试。
 * 成功返回解析结果，均失败返回 null。
 */
function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 直接解析失败，尝试修复
  }

  try {
    const repaired = repairJson(text);
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 检测文本中是否包含疑似工具调用但解析失败的模式。
 * 用于 L3 重试判断：如果 parseToolCallsFromText 返回空但文本看起来有意图调用工具，
 * 说明格式有问题，值得让 LLM 重试。
 */
export function looksLikeFailedToolCall(text: string): boolean {
  // 包含 <tool 标签但 parseToolCallsFromText 返回空
  if (/<tool\s/i.test(text)) return true;
  // 包含 ```tool 块
  if (/```tool\b/i.test(text)) return true;
  return false;
}
