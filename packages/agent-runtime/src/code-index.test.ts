import { describe, it, expect, beforeAll } from 'vitest';
import { CodeIndex } from './code-index.js';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

describe('CodeIndex', () => {
  let index: CodeIndex;

  beforeAll(async () => {
    index = new CodeIndex();
    await index.build(PROJECT_ROOT);
  });

  describe('build', () => {
    it('能扫描到文件', () => {
      expect(index.size).toBeGreaterThan(10);
    });

    it('排除 node_modules', () => {
      const entry = index.get('node_modules/vitest/index.js');
      expect(entry).toBeUndefined();
    });

    it('索引 TypeScript 文件的 exports', () => {
      const entry = index.get('src/agent.ts');
      expect(entry).toBeDefined();
      expect(entry!.type).toBe('ts');
      expect(entry!.exports).toContain('runAgent');
    });

    it('索引 TypeScript 文件的 imports', () => {
      const entry = index.get('src/agent.ts');
      expect(entry).toBeDefined();
      expect(entry!.imports.length).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    it('按关键词搜索相关文件', () => {
      const results = index.search(['planner']);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toContain('planner');
    });

    it('export 名匹配得分更高', () => {
      const results = index.search(['runAgent']);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe('src/agent.ts');
    });

    it('空关键词返回空', () => {
      expect(index.search([])).toHaveLength(0);
    });
  });

  describe('getDependencies', () => {
    it('能追踪 import 依赖', () => {
      const deps = index.getDependencies(resolve(PROJECT_ROOT, 'src/agent.ts'));
      expect(deps.length).toBeGreaterThan(0);
    });
  });

  describe('getProjectSummary', () => {
    it('输出项目摘要', () => {
      const summary = index.getProjectSummary();
      expect(summary).toContain('项目文件总数');
      expect(summary.length).toBeGreaterThan(50);
    });
  });

  describe('getReferencedBy', () => {
    it('找到 import 某文件的文件', () => {
      // agent.ts import 了 intent.ts
      const refs = index.getReferencedBy('src/intent.ts');
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.some(r => r.path === 'src/agent.ts')).toBe(true);
    });

    it('没有被引用的文件返回空', () => {
      // test 文件通常不被其他文件 import
      const refs = index.getReferencedBy('src/planner.test.ts');
      expect(refs).toHaveLength(0);
    });
  });

  describe('getImpactedFiles', () => {
    it('返回受影响的文件链', () => {
      // 改 intent.ts → agent.ts 受影响
      const impacted = index.getImpactedFiles('src/intent.ts');
      expect(impacted.length).toBeGreaterThan(0);
    });
  });

  describe('findExportSymbol', () => {
    it('按 export 名查找文件', () => {
      const files = index.findExportSymbol('Consolidator');
      expect(files.length).toBeGreaterThan(0);
      expect(files[0].path).toContain('consolidator');
    });

    it('不存在的 symbol 返回空', () => {
      expect(index.findExportSymbol('NonExistentSymbol12345')).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('增量更新不报错', async () => {
      await index.update(resolve(PROJECT_ROOT, 'src/agent.ts'));
      const entry = index.get('src/agent.ts');
      expect(entry).toBeDefined();
    });

    it('删除的文件会从索引移除', async () => {
      await index.update(resolve(PROJECT_ROOT, 'nonexistent-file.ts'));
      expect(index.get('nonexistent-file.ts')).toBeUndefined();
    });
  });
});
