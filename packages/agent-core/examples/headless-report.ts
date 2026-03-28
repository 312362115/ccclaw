// Headless Report Generation Demo
//
// Usage: QWEN_API_KEY=sk-xxx npx tsx packages/agent-core/examples/headless-report.ts

import { createAgent } from '../src/index.js';

// Mock tools simulating data sources
const tools = [
  {
    name: 'search_market_data',
    description: '搜索市场数据，返回行业统计信息',
    schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        year: { type: 'string', description: '年份，如 2025' },
      },
      required: ['query'],
    },
    execute: async (input: Record<string, unknown>) => {
      const data: Record<string, string> = {
        '新能源汽车': '2025年中国新能源汽车销量达1200万辆，同比增长35%。比亚迪市占率28%，特斯拉15%，吉利10%。',
        '电池': '宁德时代全球市占率37%，比亚迪弗迪电池16%。固态电池预计2027年量产。',
        '充电桩': '截至2025年底，全国充电桩保有量超800万个，公共充电桩240万个。',
      };
      const key = Object.keys(data).find(k => String(input.query).includes(k));
      return key ? data[key] : `未找到关于"${input.query}"的数据`;
    },
  },
  {
    name: 'get_company_financials',
    description: '获取公司财务数据',
    schema: {
      type: 'object' as const,
      properties: {
        company: { type: 'string', description: '公司名称' },
      },
      required: ['company'],
    },
    execute: async (input: Record<string, unknown>) => {
      const data: Record<string, string> = {
        '比亚迪': '2025年营收7200亿元，净利润420亿元，同比增长28%。',
        '宁德时代': '2025年营收4100亿元，净利润520亿元，同比增长15%。',
        '特斯拉': '2025年中国区营收1800亿元，全球营收约960亿美元。',
      };
      return data[String(input.company)] ?? `未找到${input.company}的财务数据`;
    },
  },
];

async function main() {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    console.error('请设置 QWEN_API_KEY 环境变量');
    process.exit(1);
  }

  console.log('🚀 Creating agent...');

  const agent = createAgent({
    model: 'qwen3.5-plus',
    apiKey,
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    systemPrompt: `你是一位资深行业分析师。请根据工具获取的数据，撰写一份专业的行业分析报告。

要求：
1. 使用所有可用工具充分获取数据
2. 报告包含：市场概况、主要玩家分析、趋势展望
3. 数据驱动，每个观点有数据支撑
4. 输出格式：Markdown，带标题层级`,
    tools,
    maxIterations: 15,
    promptEnhancements: { toolUseGuidance: true },
  });

  console.log('📊 Running analysis...\n');

  const result = await agent.run('分析 2025 年中国新能源汽车行业格局，重点关注比亚迪、宁德时代、特斯拉');

  console.log('='.repeat(60));
  console.log('📄 REPORT');
  console.log('='.repeat(60));
  console.log(result.text);
  console.log('\n' + '='.repeat(60));
  console.log(`📈 Stats: ${result.iterations} iterations, ${result.toolCalls.length} tool calls`);
  console.log(`💰 Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
}

main().catch(console.error);
