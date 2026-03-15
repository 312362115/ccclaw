import { execSync } from 'node:child_process';
import type { Tool } from './index.js';

export const bashTool: Tool = {
  name: 'bash',
  description: '在沙箱中执行 shell 命令',
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
