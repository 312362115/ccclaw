import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from './workspace-db.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextAssembler } from './context-assembler.js';
import type { ISkillLoader, ServerContext } from './context-assembler.js';

let db: WorkspaceDB;
let registry: ToolRegistry;
let assembler: ContextAssembler;
let tmpDir: string;
let homeDir: string;

const mockSkillLoader: ISkillLoader = {
  getAlwaysActiveContent: () => '## Always Skill\n始终激活的技能内容',
  getSummaryXML: () => '<skills>\n  <skill name="test">测试技能</skill>\n</skills>',
};

const defaultContext: ServerContext = {
  workspaceId: 'ws-1',
  workspaceName: '测试工作区',
  userPreferences: {},
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ctx-test-'));
  homeDir = join(tmpDir, 'home');
  mkdirSync(homeDir, { recursive: true });
  db = new WorkspaceDB(join(tmpDir, 'test.db'));
  registry = new ToolRegistry();
  assembler = new ContextAssembler(db, mockSkillLoader, registry, homeDir);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ContextAssembler', () => {
  it('基本组装：空数据不报错', () => {
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.systemPrompt).toBeTruthy();
    expect(ctx.messages).toEqual([]);
    expect(ctx.tools).toEqual([]);
  });

  it('Bootstrap 文件加载', () => {
    const bootstrapDir = join(homeDir, '.ccclaw');
    mkdirSync(bootstrapDir, { recursive: true });
    writeFileSync(join(bootstrapDir, 'AGENTS.md'), '# Agent 指令\n你是一个助手');
    writeFileSync(join(bootstrapDir, 'SOUL.md'), '# 性格\n友善专业');

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.systemPrompt).toContain('AGENTS.md');
    expect(ctx.systemPrompt).toContain('Agent 指令');
    expect(ctx.systemPrompt).toContain('SOUL.md');
    expect(ctx.systemPrompt).toContain('友善专业');
  });

  it('Bootstrap 超长截断', () => {
    const bootstrapDir = join(homeDir, '.ccclaw');
    mkdirSync(bootstrapDir, { recursive: true });
    writeFileSync(join(bootstrapDir, 'AGENTS.md'), 'x'.repeat(20000));

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.systemPrompt).toContain('...(truncated)');
  });

  it('用户偏好注入', () => {
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({
      sessionId: session.id,
      serverContext: {
        ...defaultContext,
        userPreferences: {
          customInstructions: '始终使用中文回复',
          toolConfirmMode: 'always',
        },
      },
    });

    expect(ctx.systemPrompt).toContain('始终使用中文回复');
    expect(ctx.systemPrompt).toContain('always');
  });

  it('记忆分级注入', () => {
    db.upsertMemory({ name: 'rule-1', type: 'decision', content: '不使用 eval' });
    db.upsertMemory({ name: 'proj-info', type: 'project', content: '项目使用 TypeScript' });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    // decision 全文注入
    expect(ctx.systemPrompt).toContain('行为约束');
    expect(ctx.systemPrompt).toContain('不使用 eval');
    // project 索引注入
    expect(ctx.systemPrompt).toContain('<memories');
    expect(ctx.systemPrompt).toContain('proj-info');
    expect(ctx.systemPrompt).toContain('memory_read');
  });

  it('Skills 注入', () => {
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.systemPrompt).toContain('Always Skill');
    expect(ctx.systemPrompt).toContain('<skills>');
  });

  it('无 SkillLoader 不报错', () => {
    const noSkillAssembler = new ContextAssembler(db, null, registry, homeDir);
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = noSkillAssembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.systemPrompt).not.toContain('<skills>');
  });

  it('工具定义传递', () => {
    registry.register({
      name: 'bash',
      description: '执行命令',
      schema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'cmd' } },
        required: ['command'],
      },
      async execute() { return ''; },
    });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.tools).toHaveLength(1);
    expect(ctx.tools[0].name).toBe('bash');
  });

  it('Session 历史消息', () => {
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    db.appendMessage({ session_id: session.id, role: 'user', content: 'hello' });
    db.appendMessage({ session_id: session.id, role: 'assistant', content: 'hi there' });

    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].role).toBe('user');
    expect(ctx.messages[1].content).toBe('hi there');
  });

  it('Bootstrap 空文件不报错', () => {
    const bootstrapDir = join(homeDir, '.ccclaw');
    mkdirSync(bootstrapDir, { recursive: true });
    writeFileSync(join(bootstrapDir, 'AGENTS.md'), '');

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    // 空文件仍然包含标题
    expect(ctx.systemPrompt).toContain('AGENTS.md');
  });

  it('Bootstrap 多文件按顺序加载', () => {
    const bootstrapDir = join(homeDir, '.ccclaw');
    mkdirSync(bootstrapDir, { recursive: true });
    writeFileSync(join(bootstrapDir, 'AGENTS.md'), '内容A');
    writeFileSync(join(bootstrapDir, 'SOUL.md'), '内容B');
    writeFileSync(join(bootstrapDir, 'USER.md'), '内容C');
    writeFileSync(join(bootstrapDir, 'TOOLS.md'), '内容D');

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    const prompt = ctx.systemPrompt;
    const posA = prompt.indexOf('内容A');
    const posB = prompt.indexOf('内容B');
    const posC = prompt.indexOf('内容C');
    const posD = prompt.indexOf('内容D');
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
    expect(posC).toBeLessThan(posD);
  });

  it('Bootstrap 目录不存在不报错', () => {
    // homeDir 存在但 .ccclaw 子目录不存在
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });
    // 不会有 Bootstrap 标题
    expect(ctx.systemPrompt).not.toContain('AGENTS.md');
  });

  it('压缩记忆使用 compressed_content', () => {
    db.upsertMemory({
      name: 'compressed-rule',
      type: 'decision',
      content: '原始长内容',
      compressed: 1,
      compressed_content: '压缩后的内容',
    });

    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.systemPrompt).toContain('压缩后的内容');
    expect(ctx.systemPrompt).not.toContain('原始长内容');
  });

  it('lastConsolidated 偏移读取', () => {
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    db.appendMessage({ session_id: session.id, role: 'user', content: 'msg1' });
    db.appendMessage({ session_id: session.id, role: 'assistant', content: 'msg2' });
    db.appendMessage({ session_id: session.id, role: 'user', content: 'msg3' });

    // 模拟已整合前 2 条
    db.updateSession(session.id, { last_consolidated: 2 });

    const ctx = assembler.assemble({ sessionId: session.id, serverContext: defaultContext });

    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toBe('msg3');
  });
});
