import { execSync } from 'node:child_process';
import type { Tool } from './index.js';

export const gitTool: Tool = {
  name: 'git',
  description: '执行 git 命令',
  async execute(input) {
    const { args } = input as { args: string };
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      cwd: process.env.WORKSPACE_DIR ?? '/workspace',
      timeout: 30_000,
    });
  },
};
