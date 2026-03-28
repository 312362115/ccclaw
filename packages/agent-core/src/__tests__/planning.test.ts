import { describe, it, expect } from 'vitest';
import { shouldPlan, parsePlan, formatPlanForDisplay, buildStepContext } from '../planning/planner.js';
import type { Plan, StepResult } from '../planning/types.js';

// ============================================================
// shouldPlan() 测试
// ============================================================

describe('shouldPlan', () => {
  it('对包含复杂度关键词的长消息返回 true', () => {
    const msg = '请帮我实现一个完整的用户管理模块，包含注册、登录、权限控制等功能，需要对接现有的数据库和认证系统';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('对包含"重构"关键词的中等长度消息返回 true', () => {
    const msg = '需要重构现有的认证模块，把 session-based 改为 JWT，同时保持向后兼容';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('对包含"迁移"关键词的消息返回 true', () => {
    const msg = '把 planning 系统从 agent-runtime 迁移到 agent-core，去掉 ccclaw 依赖';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('对包含"架构"关键词的消息返回 true', () => {
    const msg = '重新设计整个项目的架构，把单体应用拆分为微服务，需要考虑服务间通信和数据一致性问题';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('对短的简单消息返回 false', () => {
    expect(shouldPlan('修复一下按钮样式')).toBe(false);
  });

  it('对简单短命令返回 false', () => {
    expect(shouldPlan('改一下颜色')).toBe(false);
  });

  it('对提及多个文件的消息返回 true', () => {
    const msg = '修改 src/api/users.ts、src/pages/UserList.tsx 和 src/utils/csv.ts 这几个文件';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('对包含编号列表的消息返回 true', () => {
    const msg = `请完成以下任务：
1. 创建数据模型
2. 实现 API 接口
3. 编写前端页面`;
    expect(shouldPlan(msg)).toBe(true);
  });
});

// ============================================================
// parsePlan() 测试
// ============================================================

describe('parsePlan', () => {
  const validPlanJson = JSON.stringify({
    summary: '测试计划',
    complexity: 'simple',
    steps: [
      {
        step: 1,
        description: '第一步',
        files: ['src/index.ts'],
        action: 'modify',
        detail: '修改入口文件',
        dependsOn: [],
      },
    ],
  });

  it('能直接解析 JSON 字符串', () => {
    const plan = parsePlan(validPlanJson);
    expect(plan).not.toBeNull();
    expect(plan!.summary).toBe('测试计划');
    expect(plan!.steps).toHaveLength(1);
    expect(plan!.steps[0].description).toBe('第一步');
  });

  it('能从 markdown 代码块中提取 Plan', () => {
    const text = `好的，这是我的计划：

\`\`\`json
${validPlanJson}
\`\`\`

以上是执行方案。`;

    const plan = parsePlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.summary).toBe('测试计划');
  });

  it('能从混合文本中提取 JSON 对象', () => {
    const text = `我来分析一下需求...

${validPlanJson}

希望这个方案可行。`;

    const plan = parsePlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.summary).toBe('测试计划');
  });

  it('对无效输入返回 null', () => {
    expect(parsePlan('这不是 JSON')).toBeNull();
    expect(parsePlan('')).toBeNull();
    expect(parsePlan('{invalid}')).toBeNull();
  });

  it('对缺少 summary 的 JSON 返回 null', () => {
    const invalid = JSON.stringify({ steps: [{ step: 1, description: 'test' }] });
    expect(parsePlan(invalid)).toBeNull();
  });

  it('对空 steps 数组返回 null', () => {
    const invalid = JSON.stringify({ summary: 'test', steps: [] });
    expect(parsePlan(invalid)).toBeNull();
  });
});

// ============================================================
// formatPlanForDisplay() 测试
// ============================================================

describe('formatPlanForDisplay', () => {
  const plan: Plan = {
    summary: '新增导出功能',
    complexity: 'medium',
    steps: [
      {
        step: 1,
        description: '新增后端接口',
        files: ['src/api/export.ts'],
        action: 'create',
        detail: '创建 CSV 导出接口',
        dependsOn: [],
      },
      {
        step: 2,
        description: '前端添加按钮',
        files: ['src/pages/List.tsx'],
        action: 'modify',
        detail: '添加导出按钮',
        dependsOn: [1],
      },
    ],
  };

  it('生成包含方案概述的可读文本', () => {
    const text = formatPlanForDisplay(plan);
    expect(text).toContain('新增导出功能');
    expect(text).toContain('medium');
    expect(text).toContain('步骤数');
  });

  it('包含每个步骤的描述', () => {
    const text = formatPlanForDisplay(plan);
    expect(text).toContain('新增后端接口');
    expect(text).toContain('前端添加按钮');
  });

  it('显示步骤的文件列表', () => {
    const text = formatPlanForDisplay(plan);
    expect(text).toContain('src/api/export.ts');
    expect(text).toContain('src/pages/List.tsx');
  });

  it('显示依赖关系', () => {
    const text = formatPlanForDisplay(plan);
    expect(text).toContain('依赖步骤 1');
  });
});

// ============================================================
// buildStepContext() 测试
// ============================================================

describe('buildStepContext', () => {
  const plan: Plan = {
    summary: '重构认证模块',
    complexity: 'complex',
    steps: [
      {
        step: 1,
        description: '创建 Redis 连接',
        files: ['src/lib/redis.ts'],
        action: 'create',
        detail: '封装 Redis 客户端',
        dependsOn: [],
      },
      {
        step: 2,
        description: '改造 Session 中间件',
        files: ['src/middleware/session.ts'],
        action: 'modify',
        detail: '替换为 Redis-backed session',
        dependsOn: [1],
      },
    ],
  };

  it('包含整体方案概述', () => {
    const ctx = buildStepContext(plan, 0, []);
    expect(ctx).toContain('重构认证模块');
  });

  it('包含当前步骤详情', () => {
    const ctx = buildStepContext(plan, 0, []);
    expect(ctx).toContain('封装 Redis 客户端');
  });

  it('包含前序步骤摘要', () => {
    const prevResults: StepResult[] = [
      { stepIndex: 0, success: true, summary: 'Redis 连接模块创建完成' },
    ];
    const ctx = buildStepContext(plan, 1, prevResults);
    expect(ctx).toContain('Redis 连接模块创建完成');
    expect(ctx).toContain('替换为 Redis-backed session');
  });

  it('对无效步骤索引返回空字符串', () => {
    expect(buildStepContext(plan, 99, [])).toBe('');
  });
});
