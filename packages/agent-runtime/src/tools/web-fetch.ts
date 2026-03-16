import type { Tool } from '../tool-registry.js';

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: '获取 URL 内容',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要获取的 URL（仅支持 HTTP/HTTPS）' },
    },
    required: ['url'],
  },
  async execute(input) {
    const { url } = input as { url: string };

    // 安全校验：仅允许 http/https
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('仅支持 HTTP/HTTPS 协议');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CCCLaw-Agent/1.0' },
      });
      const text = await res.text();
      // 截断过长响应
      return text.length > 50_000 ? text.slice(0, 50_000) + '\n...(内容已截断)' : text;
    } finally {
      clearTimeout(timer);
    }
  },
};
