/**
 * CodeIndex — 轻量代码索引
 *
 * 设计原则：
 * - 纯正则提取，零外部依赖（不用 Tree-sitter / LSP）
 * - 索引在内存中，启动时全量扫描，文件变更时增量更新
 * - 正则能覆盖 80% 场景，剩余 20% 靠模型的 grep/read 工具补充
 *
 * 用途：
 * - 给 ContextAssembler 提供项目结构摘要（Level 0 Context）
 * - 给 Agent 提供相关文件的 export 签名（Level 1 Context）
 * - 给验证器提供依赖链（改了 A 影响哪些文件）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { logger } from './logger.js';

// ====== Types ======

export interface ImportRef {
  from: string;
  names: string[];
}

export type FileType = 'ts' | 'js' | 'py' | 'json' | 'css' | 'html' | 'md' | 'other';

export interface FileIndex {
  /** 相对于项目根的路径 */
  path: string;
  size: number;
  lastModified: number;
  exports: string[];
  imports: ImportRef[];
  type: FileType;
}

// ====== Constants ======

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '__pycache__', '.venv', 'venv',
  '.turbo', '.output', '.svelte-kit',
]);

const EXCLUDED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);

const MAX_FILE_SIZE = 100_000; // 100KB — 超过的文件只记路径不解析
const MAX_FILES = 5000;        // 最多索引 5000 个文件

// ====== 正则提取 ======

/** TypeScript/JavaScript export 提取 */
const TS_EXPORT_RE = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/g;

/** TypeScript/JavaScript import 提取 */
const TS_IMPORT_RE = /import\s+(?:(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+)?['"]([^'"]+)['"]/g;

/** Python def/class 提取 */
const PY_DEF_RE = /^(?:def|class)\s+(\w+)/gm;

/** Python import 提取 */
const PY_IMPORT_RE = /^(?:from\s+([\w.]+)\s+import\s+(.+)|import\s+([\w.]+))/gm;

function detectFileType(filePath: string): FileType {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts': case '.tsx': case '.mts': case '.cts': return 'ts';
    case '.js': case '.jsx': case '.mjs': case '.cjs': return 'js';
    case '.py': return 'py';
    case '.json': return 'json';
    case '.css': case '.scss': case '.less': return 'css';
    case '.html': case '.htm': return 'html';
    case '.md': case '.mdx': return 'md';
    default: return 'other';
  }
}

function extractTypeScript(content: string): { exports: string[]; imports: ImportRef[] } {
  const exports: string[] = [];
  const imports: ImportRef[] = [];

  let match: RegExpExecArray | null;

  TS_EXPORT_RE.lastIndex = 0;
  while ((match = TS_EXPORT_RE.exec(content)) !== null) {
    exports.push(match[1]);
  }

  TS_IMPORT_RE.lastIndex = 0;
  while ((match = TS_IMPORT_RE.exec(content)) !== null) {
    const namedImports = match[1]?.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) ?? [];
    const defaultImport = match[2] ? [match[2]] : [];
    const from = match[3];
    imports.push({ from, names: [...namedImports, ...defaultImport] });
  }

  return { exports, imports };
}

function extractPython(content: string): { exports: string[]; imports: ImportRef[] } {
  const exports: string[] = [];
  const imports: ImportRef[] = [];

  let match: RegExpExecArray | null;

  PY_DEF_RE.lastIndex = 0;
  while ((match = PY_DEF_RE.exec(content)) !== null) {
    exports.push(match[1]);
  }

  PY_IMPORT_RE.lastIndex = 0;
  while ((match = PY_IMPORT_RE.exec(content)) !== null) {
    if (match[1]) {
      // from X import Y
      const names = match[2].split(',').map(s => s.trim()).filter(Boolean);
      imports.push({ from: match[1], names });
    } else if (match[3]) {
      // import X
      imports.push({ from: match[3], names: [] });
    }
  }

  return { exports, imports };
}

// ====== CodeIndex ======

export class CodeIndex {
  private index = new Map<string, FileIndex>();
  private rootDir: string = '';

  /** 扫描项目目录，建立全量索引 */
  async build(rootDir: string): Promise<void> {
    this.rootDir = rootDir;
    this.index.clear();

    const startTime = Date.now();
    this.scanDir(rootDir);
    const elapsed = Date.now() - startTime;

    logger.info({ files: this.index.size, elapsed }, 'CodeIndex 构建完成');
  }

  /** 增量更新单个文件的索引 */
  async update(filePath: string): Promise<void> {
    const relPath = relative(this.rootDir, filePath);
    try {
      const stat = statSync(filePath);
      const entry = this.parseFile(filePath, relPath, stat.size, stat.mtimeMs);
      if (entry) {
        this.index.set(relPath, entry);
      }
    } catch {
      // 文件被删除 → 移除索引
      this.index.delete(relPath);
    }
  }

  /** 关键词搜索相关文件（按相关度排序） */
  search(keywords: string[], maxResults: number = 10): FileIndex[] {
    if (keywords.length === 0) return [];

    const normalizedKw = keywords.map(k => k.toLowerCase());
    const scored: Array<{ entry: FileIndex; score: number }> = [];

    for (const entry of this.index.values()) {
      let score = 0;

      for (const kw of normalizedKw) {
        // 路径匹配
        if (entry.path.toLowerCase().includes(kw)) score += 3;
        // export 名匹配
        for (const exp of entry.exports) {
          if (exp.toLowerCase().includes(kw)) score += 5;
        }
        // import 模块名匹配
        for (const imp of entry.imports) {
          if (imp.from.toLowerCase().includes(kw)) score += 1;
        }
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map(s => s.entry);
  }

  /** 获取文件的直接依赖链（按 import 追踪） */
  getDependencies(filePath: string, depth: number = 1): FileIndex[] {
    const relPath = relative(this.rootDir, filePath);
    const entry = this.index.get(relPath);
    if (!entry) return [];

    const result = new Map<string, FileIndex>();
    this.traceDeps(entry, depth, result);
    return [...result.values()];
  }

  /** 生成项目结构摘要（用于 Level 0 Context） */
  getProjectSummary(): string {
    // 按目录聚合
    const dirs = new Map<string, { count: number; types: Set<string>; topExports: string[] }>();

    for (const entry of this.index.values()) {
      const dir = entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : '.';
      let info = dirs.get(dir);
      if (!info) {
        info = { count: 0, types: new Set(), topExports: [] };
        dirs.set(dir, info);
      }
      info.count++;
      info.types.add(entry.type);
      if (entry.exports.length > 0 && info.topExports.length < 5) {
        info.topExports.push(...entry.exports.slice(0, 2));
      }
    }

    const lines = [`项目文件总数: ${this.index.size}`, ''];
    const sortedDirs = [...dirs.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20);

    for (const [dir, info] of sortedDirs) {
      const types = [...info.types].join('/');
      const exports = info.topExports.length > 0 ? ` — ${info.topExports.slice(0, 4).join(', ')}` : '';
      lines.push(`${dir}/ (${info.count} ${types} files)${exports}`);
    }

    return lines.join('\n');
  }

  /** 获取索引中的文件数 */
  get size(): number {
    return this.index.size;
  }

  /** 获取指定文件的索引 */
  get(relPath: string): FileIndex | undefined {
    return this.index.get(relPath);
  }

  /**
   * 反向引用：查找哪些文件 import 了指定文件。
   * 给定 "src/utils.ts"，返回所有 import 了它的文件。
   */
  getReferencedBy(relPath: string): FileIndex[] {
    const result: FileIndex[] = [];
    // 构建可能的 import 路径变体
    const variants = this.buildImportVariants(relPath);

    for (const entry of this.index.values()) {
      if (entry.path === relPath) continue;
      for (const imp of entry.imports) {
        if (variants.some(v => imp.from.includes(v))) {
          result.push(entry);
          break;
        }
      }
    }

    return result;
  }

  /**
   * 影响分析：改了指定文件后，哪些文件可能受影响。
   *
   * 分析维度：
   * 1. 直接引用：import 了该文件的文件
   * 2. 间接引用：引用者的引用者（depth 层）
   * 3. 同目录文件：同目录下的 index.ts 等入口文件
   */
  getImpactedFiles(relPath: string, depth: number = 2): FileIndex[] {
    const visited = new Set<string>();
    const result: FileIndex[] = [];

    this.traceImpact(relPath, depth, visited, result);
    return result;
  }

  /**
   * 查找包含指定 export 符号名的文件。
   */
  findExportSymbol(symbolName: string): FileIndex[] {
    const results: FileIndex[] = [];
    const normalized = symbolName.toLowerCase();

    for (const entry of this.index.values()) {
      if (entry.exports.some(e => e.toLowerCase() === normalized)) {
        results.push(entry);
      }
    }

    return results;
  }

  // ====== Private ======

  /** 构建文件路径的可能 import 变体 */
  private buildImportVariants(relPath: string): string[] {
    // src/utils.ts → ['utils', 'src/utils', './utils']
    const withoutExt = relPath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
    const parts = withoutExt.split('/');
    const fileName = parts[parts.length - 1];
    const variants = [fileName, withoutExt];

    // 处理 index 文件：src/tools/index.ts → import from './tools'
    if (fileName === 'index') {
      const dirPath = parts.slice(0, -1).join('/');
      const dirName = parts[parts.length - 2];
      if (dirName) variants.push(dirName, dirPath);
    }

    return variants;
  }

  private traceImpact(relPath: string, depth: number, visited: Set<string>, result: FileIndex[]): void {
    if (depth <= 0 || visited.has(relPath)) return;
    visited.add(relPath);

    const refs = this.getReferencedBy(relPath);
    for (const ref of refs) {
      if (!visited.has(ref.path)) {
        result.push(ref);
        this.traceImpact(ref.path, depth - 1, visited, result);
      }
    }
  }

  private scanDir(dir: string): void {
    if (this.index.size >= MAX_FILES) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (this.index.size >= MAX_FILES) return;
      if (EXCLUDED_DIRS.has(name)) continue;
      if (EXCLUDED_FILES.has(name)) continue;
      if (name.startsWith('.')) continue;

      const fullPath = join(dir, name);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.scanDir(fullPath);
      } else if (stat.isFile()) {
        const relPath = relative(this.rootDir, fullPath);
        const entry = this.parseFile(fullPath, relPath, stat.size, stat.mtimeMs);
        if (entry) {
          this.index.set(relPath, entry);
        }
      }
    }
  }

  private parseFile(fullPath: string, relPath: string, size: number, mtimeMs: number): FileIndex | null {
    const type = detectFileType(fullPath);
    if (type === 'other') return null; // 不索引未知类型

    const entry: FileIndex = {
      path: relPath,
      size,
      lastModified: mtimeMs,
      exports: [],
      imports: [],
      type,
    };

    // 大文件只记元数据
    if (size > MAX_FILE_SIZE) return entry;

    // 只解析 ts/js/py 的 export/import
    if (type === 'ts' || type === 'js') {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const extracted = extractTypeScript(content);
        entry.exports = extracted.exports;
        entry.imports = extracted.imports;
      } catch { /* 读取失败跳过 */ }
    } else if (type === 'py') {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const extracted = extractPython(content);
        entry.exports = extracted.exports;
        entry.imports = extracted.imports;
      } catch { /* 读取失败跳过 */ }
    }

    return entry;
  }

  private traceDeps(entry: FileIndex, depth: number, result: Map<string, FileIndex>): void {
    if (depth <= 0) return;

    // 从 entry 所在目录出发解析相对路径
    const entryDir = entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : '';

    for (const imp of entry.imports) {
      // 跳过外部包（不以 . 开头的）
      if (!imp.from.startsWith('.')) continue;

      // 去掉 .js/.ts 扩展名，构建可能的路径
      const stripped = imp.from.replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, '');
      const resolved = entryDir ? `${entryDir}/${stripped.replace(/^\.\//, '')}` : stripped.replace(/^\.\//, '');
      // 标准化 ../ 路径
      const normalized = normalizePath(resolved);

      // 尝试多种扩展名匹配
      const candidates = [
        normalized + '.ts',
        normalized + '.tsx',
        normalized + '.js',
        normalized + '.jsx',
        normalized + '/index.ts',
        normalized + '/index.js',
      ];

      for (const candidate of candidates) {
        if (result.has(candidate)) break;
        const idx = this.index.get(candidate);
        if (idx) {
          result.set(candidate, idx);
          this.traceDeps(idx, depth - 1, result);
          break;
        }
      }
    }
  }
}

/** 标准化路径：处理 ../ 片段 */
function normalizePath(p: string): string {
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      stack.pop();
    } else if (part !== '.') {
      stack.push(part);
    }
  }
  return stack.join('/');
}
