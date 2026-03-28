import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader, resolvePrompt } from '../skills/loader.js';
import type { PromptSkill, CodeSkill, Skill } from '../skills/types.js';
import type { Tool } from '../tools/types.js';

// ============================================================
// 辅助工具
// ============================================================

function makePromptSkill(overrides: Partial<PromptSkill> = {}): PromptSkill {
  return {
    type: 'prompt',
    name: 'test-skill',
    description: 'A test skill',
    prompt: 'Default prompt text',
    always: false,
    ...overrides,
  };
}

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    async execute() {
      return 'ok';
    },
  };
}

function makeCodeSkill(overrides: Partial<CodeSkill> = {}): CodeSkill {
  return {
    type: 'code',
    name: 'code-skill',
    description: 'A code skill',
    prompt: 'Code skill prompt',
    always: false,
    hooks: {
      beforeToolCall: async () => ({ block: false }),
      afterToolCall: async () => {},
    },
    ...overrides,
  };
}

// ============================================================
// resolvePrompt — 按能力分层解析 prompt
// ============================================================

describe('resolvePrompt', () => {
  it('返回默认 prompt（无 promptByTier）', () => {
    const skill = makePromptSkill({ prompt: 'default' });
    expect(resolvePrompt(skill, 5)).toBe('default');
  });

  it('strong 模型（tier >= 5）使用 strong 变体', () => {
    const skill = makePromptSkill({
      prompt: 'default',
      promptByTier: { strong: 'strong prompt', medium: 'medium prompt', weak: 'weak prompt' },
    });
    expect(resolvePrompt(skill, 5)).toBe('strong prompt');
    expect(resolvePrompt(skill, 7)).toBe('strong prompt');
  });

  it('medium 模型（tier 3-4）使用 medium 变体', () => {
    const skill = makePromptSkill({
      prompt: 'default',
      promptByTier: { strong: 'strong', medium: 'medium', weak: 'weak' },
    });
    expect(resolvePrompt(skill, 3)).toBe('medium');
    expect(resolvePrompt(skill, 4)).toBe('medium');
  });

  it('weak 模型（tier <= 2）使用 weak 变体', () => {
    const skill = makePromptSkill({
      prompt: 'default',
      promptByTier: { strong: 'strong', medium: 'medium', weak: 'weak' },
    });
    expect(resolvePrompt(skill, 1)).toBe('weak');
    expect(resolvePrompt(skill, 2)).toBe('weak');
  });

  it('缺少对应变体时回退到默认 prompt', () => {
    const skill = makePromptSkill({
      prompt: 'default',
      promptByTier: { strong: 'strong' },
    });
    // medium tier 没有变体，回退
    expect(resolvePrompt(skill, 3)).toBe('default');
    // weak tier 没有变体，回退
    expect(resolvePrompt(skill, 1)).toBe('default');
  });
});

// ============================================================
// SkillLoader — inline skills
// ============================================================

describe('SkillLoader — inline skills', () => {
  it('注册 inline PromptSkill', () => {
    const skill = makePromptSkill({ name: 'inline-1' });
    const loader = new SkillLoader({ inline: [skill] });
    loader.loadAll();

    expect(loader.getSkills()).toHaveLength(1);
    expect(loader.getSkills()[0].name).toBe('inline-1');
  });

  it('注册 inline CodeSkill 并收集钩子', () => {
    const beforeHook = vi.fn(async () => ({ block: false }));
    const afterHook = vi.fn(async () => {});
    const skill = makeCodeSkill({
      hooks: { beforeToolCall: beforeHook, afterToolCall: afterHook },
    });

    const loader = new SkillLoader({ inline: [skill] });
    loader.loadAll();

    const hooks = loader.getHooks();
    expect(hooks.beforeToolCall).toHaveLength(1);
    expect(hooks.afterToolCall).toHaveLength(1);
    expect(hooks.beforeToolCall[0]).toBe(beforeHook);
    expect(hooks.afterToolCall[0]).toBe(afterHook);
  });

  it('PromptSkill 不产生钩子', () => {
    const loader = new SkillLoader({ inline: [makePromptSkill()] });
    loader.loadAll();

    const hooks = loader.getHooks();
    expect(hooks.beforeToolCall).toHaveLength(0);
    expect(hooks.afterToolCall).toHaveLength(0);
  });
});

// ============================================================
// getPromptContent — always=true 的 Skill 注入
// ============================================================

describe('getPromptContent', () => {
  it('包含 always=true 的 Skill prompt', () => {
    const loader = new SkillLoader({
      inline: [
        makePromptSkill({ name: 'always-skill', prompt: 'Always active', always: true }),
        makePromptSkill({ name: 'on-demand', prompt: 'On demand', always: false }),
      ],
    });
    loader.loadAll();

    const content = loader.getPromptContent(5);
    expect(content).toContain('always-skill');
    expect(content).toContain('Always active');
    expect(content).not.toContain('on-demand');
    expect(content).not.toContain('On demand');
  });

  it('按 capabilityTier 解析 prompt 变体', () => {
    const loader = new SkillLoader({
      inline: [
        makePromptSkill({
          name: 'tiered',
          prompt: 'default',
          promptByTier: { strong: 'STRONG', weak: 'WEAK' },
          always: true,
        }),
      ],
    });
    loader.loadAll();

    expect(loader.getPromptContent(5)).toContain('STRONG');
    expect(loader.getPromptContent(1)).toContain('WEAK');
    expect(loader.getPromptContent(3)).toContain('default');
  });
});

// ============================================================
// getSkillSummaryXML — 非 always Skill 的摘要
// ============================================================

describe('getSkillSummaryXML', () => {
  it('包含非 always Skill 的 XML 摘要', () => {
    const loader = new SkillLoader({
      inline: [
        makePromptSkill({ name: 'skill-a', description: 'Desc A', always: false }),
        makePromptSkill({ name: 'skill-b', description: 'Desc B', always: true }),
      ],
    });
    loader.loadAll();

    const xml = loader.getSkillSummaryXML();
    expect(xml).toContain('<skill name="skill-a"');
    expect(xml).toContain('Desc A');
    expect(xml).not.toContain('skill-b');
    expect(xml).toContain('count="1"');
  });

  it('无非 always Skill 时返回空字符串', () => {
    const loader = new SkillLoader({
      inline: [makePromptSkill({ always: true })],
    });
    loader.loadAll();

    expect(loader.getSkillSummaryXML()).toBe('');
  });
});

// ============================================================
// getTools — 收集 Skill 提供的工具
// ============================================================

describe('getTools', () => {
  it('收集所有 Skill 的工具', () => {
    const tool1 = makeTool('tool-1');
    const tool2 = makeTool('tool-2');

    const loader = new SkillLoader({
      inline: [
        makePromptSkill({ tools: [tool1] }),
        makeCodeSkill({ tools: [tool2] }),
      ],
    });
    loader.loadAll();

    const tools = loader.getTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['tool-1', 'tool-2']);
  });

  it('无工具时返回空数组', () => {
    const loader = new SkillLoader({ inline: [makePromptSkill()] });
    loader.loadAll();
    expect(loader.getTools()).toEqual([]);
  });
});

// ============================================================
// 目录加载 — SKILL.md frontmatter 解析
// ============================================================

describe('SkillLoader — 目录加载', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skills-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('从目录加载 SKILL.md', () => {
    const skillDir = join(tmpDir, 'my-skill');
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: A directory skill
always: true
---
This is the skill content.`,
    );

    const loader = new SkillLoader({ dirs: [tmpDir] });
    loader.loadAll();

    const skills = loader.getSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-skill');
    expect(skills[0].description).toBe('A directory skill');
    expect(skills[0].prompt).toBe('This is the skill content.');
    expect(skills[0].always).toBe(true);
  });

  it('目录名作为 fallback name', () => {
    const skillDir = join(tmpDir, 'fallback-name');
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
description: No name field
---
Content here.`,
    );

    const loader = new SkillLoader({ dirs: [tmpDir] });
    loader.loadAll();

    expect(loader.getSkills()[0].name).toBe('fallback-name');
  });

  it('跳过不存在的目录', () => {
    const loader = new SkillLoader({ dirs: ['/nonexistent/path'] });
    loader.loadAll();
    expect(loader.getSkills()).toEqual([]);
  });

  it('跳过没有 SKILL.md 的子目录', () => {
    const emptyDir = join(tmpDir, 'empty-skill');
    mkdirSync(emptyDir);

    const loader = new SkillLoader({ dirs: [tmpDir] });
    loader.loadAll();
    expect(loader.getSkills()).toEqual([]);
  });

  it('同时加载目录和 inline Skill', () => {
    const skillDir = join(tmpDir, 'dir-skill');
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: dir-skill
description: From directory
---
Dir content.`,
    );

    const inlineSkill = makePromptSkill({ name: 'inline-skill' });
    const loader = new SkillLoader({ dirs: [tmpDir], inline: [inlineSkill] });
    loader.loadAll();

    expect(loader.getSkills()).toHaveLength(2);
    const names = loader.getSkills().map((s) => s.name);
    expect(names).toContain('dir-skill');
    expect(names).toContain('inline-skill');
  });
});
