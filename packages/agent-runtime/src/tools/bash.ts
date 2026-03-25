import { spawn } from 'node:child_process';
import type { Tool, ToolExecuteContext } from '../tool-registry.js';

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
  async execute(input, context?: ToolExecuteContext) {
    const { command, timeout = 120000 } = input as { command: string; timeout?: number };
    const cwd = process.env.WORKSPACE_DIR ?? '/workspace';

    return new Promise<string>((resolve) => {
      const chunks: string[] = [];
      let killed = false;

      const proc = spawn('bash', ['-c', command], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        chunks.push(text);
        // 流式输出：实时发给前端
        context?.onProgress?.(text);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        chunks.push(text);
        context?.onProgress?.(text);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const output = chunks.join('');

        if (killed) {
          resolve(output + `\n(命令超时，已在 ${timeout}ms 后终止)`);
        } else if (code !== 0 && code !== null) {
          resolve(output + `\n(退出码: ${code})`);
        } else {
          resolve(output);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve(`Error: ${err.message}`);
      });
    });
  },
};
