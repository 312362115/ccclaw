import { execSync } from 'node:child_process';
import type { Tool } from '../tool-registry.js';

export const gitTool: Tool = {
  name: 'git',
  description: '执行 git 命令',
  schema: {
    type: 'object',
    properties: {
      args: { type: 'string', description: 'git 子命令和参数' },
    },
    required: ['args'],
  },
  async execute(input) {
    const { args } = input as { args: string };
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      cwd: process.env.WORKSPACE_DIR ?? '/workspace',
      timeout: 30_000,
    });
  },
};
