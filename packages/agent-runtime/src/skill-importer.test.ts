import { describe, it, expect } from 'vitest';
import { convertSkill } from './skill-importer.js';

describe('convertSkill', () => {
  it('转换 Claude Code 格式的 Skill', () => {
    const cc = `---
name: tdd
description: Test-driven development workflow
---

You MUST write tests before implementation...`;

    const result = convertSkill(cc);
    expect(result.success).toBe(true);
    expect(result.skill!.name).toBe('tdd');
    expect(result.skill!.description).toBe('Test-driven development workflow');
    expect(result.skill!.fullMarkdown).toContain('trust: sandbox');
    expect(result.skill!.fullMarkdown).toContain('always: false');
    expect(result.skill!.content).toContain('You MUST write tests');
  });

  it('保留 CCCLaw 已有字段', () => {
    const ccclaw = `---
name: deploy
description: Deploy workflow
command: npm run deploy
trust: trusted
always: true
---

Deploy instructions...`;

    const result = convertSkill(ccclaw);
    expect(result.success).toBe(true);
    expect(result.skill!.fullMarkdown).toContain('command: npm run deploy');
    expect(result.skill!.fullMarkdown).toContain('trust: trusted');
    expect(result.skill!.fullMarkdown).toContain('always: true');
  });

  it('缺少 name 报错', () => {
    const bad = `---
description: No name
---
content`;

    const result = convertSkill(bad);
    expect(result.success).toBe(false);
    expect(result.error).toContain('name');
  });

  it('缺少 description 报错', () => {
    const bad = `---
name: test
---
content`;

    const result = convertSkill(bad);
    expect(result.success).toBe(false);
    expect(result.error).toContain('description');
  });

  it('无 frontmatter 的纯文本报错', () => {
    const result = convertSkill('just plain text');
    expect(result.success).toBe(false);
  });
});
