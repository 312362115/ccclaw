import { execSync } from 'node:child_process';
import type { Tool } from '../tool-registry.js';

export const bashTool: Tool = {
  name: 'bash',
  description: '在沙箱中执行 shell 命令',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 shell 命令' },
      timeout: { type: 'number', description: '超时时间（毫秒），默认 120000', default: 120000 },
    },
    required: ['command'],
  },
  async execute(input) {
    const { command, timeout = 120000 } = input as { command: string; timeout?: number };
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout,
      cwd: process.env.WORKSPACE_DIR ?? '/workspace',
      maxBuffer: 1024 * 1024, // 1MB
    });
    return result;
  },
};
