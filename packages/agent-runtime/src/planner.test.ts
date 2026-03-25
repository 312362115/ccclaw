import { describe, it, expect } from 'vitest';
import { shouldPlan, parsePlan, buildStepContext, formatPlanForDisplay } from './planner.js';
import type { Plan, StepResult } from './planner.js';

// ====== shouldPlan ======

describe('shouldPlan', () => {
  it('短消息 + 简单关键词 → 不需要', () => {
    expect(shouldPlan('修一下登录按钮的样式')).toBe(false);
    expect(shouldPlan('加个 loading 状态')).toBe(false);
    expect(shouldPlan('fix the typo')).toBe(false);
  });

  it('长消息 + 复杂关键词 → 需要', () => {
    const msg = '实现一个完整的用户认证系统，包括登录、注册、密码重置、OAuth2 接入。需要新建数据库表、API 接口、前端页面。';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('提及多个文件 → 需要', () => {
    const msg = '修改 src/auth.ts、src/middleware.ts 和 src/routes/login.ts 中的 token 逻辑';
    expect(shouldPlan(msg)).toBe(true);
  });

  it('有编号列表 → 需要', () => {
    const msg = `请帮我做以下改动：
1. 新增用户模型
2. 添加 API 接口
3. 前端对接
4. 写测试`;
    expect(shouldPlan(msg)).toBe(true);
  });

  it('空消息 → 不需要', () => {
    expect(shouldPlan('')).toBe(false);
  });
});

// ====== parsePlan ======

describe('parsePlan', () => {
  const validPlanJson = JSON.stringify({
    summary: '重构认证模块',
    complexity: 'medium',
    steps: [
      { step: 1, description: '修改数据模型', files: ['src/models/user.ts'], action: 'modify', detail: '添加 refreshToken 字段', dependsOn: [] },
      { step: 2, description: '更新 API', files: ['src/api/auth.ts'], action: 'modify', detail: '新增 /refresh 接口', dependsOn: [1] },
    ],
  });

  it('直接 JSON 解析', () => {
    const plan = parsePlan(validPlanJson);
    expect(plan).not.toBeNull();
    expect(plan!.summary).toBe('重构认证模块');
    expect(plan!.steps).toHaveLength(2);
  });

  it('从 json 代码块提取', () => {
    const text = `好的，这是我的计划：\n\`\`\`json\n${validPlanJson}\n\`\`\`\n希望这个计划合理。`;
    const plan = parsePlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.steps).toHaveLength(2);
  });

  it('从无标记代码块提取', () => {
    const text = `计划如下：\n\`\`\`\n${validPlanJson}\n\`\`\``;
    const plan = parsePlan(text);
    expect(plan).not.toBeNull();
  });

  it('从混杂文本中提取 JSON 对象', () => {
    const text = `我分析了需求，计划如下：${validPlanJson}\n以上就是方案。`;
    const plan = parsePlan(text);
    expect(plan).not.toBeNull();
    expect(plan!.summary).toBe('重构认证模块');
  });

  it('无效 JSON 返回 null', () => {
    expect(parsePlan('这不是 JSON')).toBeNull();
    expect(parsePlan('{invalid')).toBeNull();
  });

  it('缺少 steps 返回 null', () => {
    expect(parsePlan('{"summary": "test"}')).toBeNull();
  });

  it('空 steps 返回 null', () => {
    expect(parsePlan('{"summary": "test", "steps": []}')).toBeNull();
  });

  it('steps 缺少 step/description 返回 null', () => {
    expect(parsePlan('{"summary": "test", "steps": [{"foo": 1}]}')).toBeNull();
  });
});

// ====== buildStepContext ======

describe('buildStepContext', () => {
  const testPlan: Plan = {
    summary: '重构认证模块',
    complexity: 'medium',
    steps: [
      { step: 1, description: '修改数据模型', files: ['src/models/user.ts'], action: 'modify', detail: '添加 refreshToken 字段', dependsOn: [] },
      { step: 2, description: '更新 API', files: ['src/api/auth.ts'], action: 'modify', detail: '新增 /refresh 接口', dependsOn: [1] },
      { step: 3, description: '验证', files: [], action: 'verify', detail: '端到端测试', dependsOn: [1, 2] },
    ],
  };

  it('第一步无前序摘要', () => {
    const ctx = buildStepContext(testPlan, 0, []);
    expect(ctx).toContain('步骤 1/3');
    expect(ctx).toContain('添加 refreshToken 字段');
    expect(ctx).toContain('重构认证模块');
    expect(ctx).not.toContain('已完成步骤');
  });

  it('后续步骤包含前序摘要', () => {
    const prevResults: StepResult[] = [
      { stepIndex: 1, success: true, summary: '已添加 refreshToken 字段' },
    ];
    const ctx = buildStepContext(testPlan, 1, prevResults);
    expect(ctx).toContain('步骤 2/3');
    expect(ctx).toContain('新增 /refresh 接口');
    expect(ctx).toContain('已添加 refreshToken 字段');
  });

  it('越界步骤返回空字符串', () => {
    expect(buildStepContext(testPlan, 99, [])).toBe('');
  });
});

// ====== formatPlanForDisplay ======

describe('formatPlanForDisplay', () => {
  it('格式化可读文本', () => {
    const plan: Plan = {
      summary: '新增导出功能',
      complexity: 'medium',
      steps: [
        { step: 1, description: '后端接口', files: ['src/api.ts'], action: 'modify', detail: '新增导出端点', dependsOn: [] },
        { step: 2, description: '前端按钮', files: ['src/page.tsx'], action: 'modify', detail: '加导出按钮', dependsOn: [1] },
      ],
    };

    const text = formatPlanForDisplay(plan);
    expect(text).toContain('## 执行计划');
    expect(text).toContain('新增导出功能');
    expect(text).toContain('步骤 1');
    expect(text).toContain('步骤 2');
    expect(text).toContain('依赖步骤 1');
    expect(text).toContain('src/api.ts');
  });
});
