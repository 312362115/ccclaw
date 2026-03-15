// Agent 工具集 — 每个工具暴露统一接口
export interface Tool {
  name: string;
  description: string;
  execute(input: Record<string, unknown>): Promise<string>;
}

export { bashTool } from './bash.js';
export { fileTool } from './file.js';
export { gitTool } from './git.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { webFetchTool } from './web-fetch.js';
