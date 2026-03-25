/**
 * Eval Runner — 自动化评测脚本
 *
 * 用法：npx tsx tests/eval/runner.ts [--provider openai] [--model qwen-max] [--cases simple]
 *
 * 流程：
 * 1. 加载用例集
 * 2. 对每个用例：初始化 fixture → 发送需求 → Agent 执行 → 验收检查
 * 3. 生成报告
 */

import { readdirSync, readFileSync, writeFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EvalCase, EvalResult, EvalReport, Difficulty } from './types.js';
import { runAcceptanceChecks } from './judge.js';
import { computeSummary, generateReport } from './report.js';

const EVAL_DIR = resolve(import.meta.dirname);
const CASES_DIR = join(EVAL_DIR, 'cases');
const FIXTURES_DIR = join(EVAL_DIR, 'fixtures');

// ====== 用例加载 ======

function loadCases(filter?: Difficulty): EvalCase[] {
  const cases: EvalCase[] = [];
  const dirs = filter ? [filter] : ['simple', 'medium', 'complex'];

  for (const dir of dirs) {
    const casesPath = join(CASES_DIR, dir);
    let files: string[];
    try {
      files = readdirSync(casesPath).filter(f => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      const content = readFileSync(join(casesPath, file), 'utf-8');
      cases.push(JSON.parse(content));
    }
  }

  return cases;
}

// ====== Fixture 初始化 ======

function initFixture(fixtureName: string): string {
  const src = join(FIXTURES_DIR, fixtureName);
  const tmpDir = join(tmpdir(), `ccclaw-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  cpSync(src, tmpDir, { recursive: true });
  return tmpDir;
}

function cleanupFixture(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ====== 单用例执行 ======

/**
 * 执行单个评测用例。
 *
 * 注意：当前版本是"干跑"模式——不实际调用 Agent，只验证框架能跑通。
 * 实际集成 Agent 调用需要在 runAgentOnTask() 中实现。
 */
async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  const startTime = Date.now();
  let workDir = '';

  try {
    // 初始化 fixture
    workDir = initFixture(evalCase.fixture);

    // TODO: 实际调用 Agent
    // const agentResult = await runAgentOnTask(evalCase.description, workDir);

    // 运行验收检查
    const judgeResult = runAcceptanceChecks(evalCase.acceptance, workDir);

    const durationMs = Date.now() - startTime;

    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      difficulty: evalCase.difficulty,
      firstPassSuccess: judgeResult.passed,
      finalSuccess: judgeResult.passed,
      iterations: 1,
      durationMs,
      inputTokens: 0,
      outputTokens: 0,
      failedChecks: judgeResult.failedChecks,
    };
  } catch (err: any) {
    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      difficulty: evalCase.difficulty,
      firstPassSuccess: false,
      finalSuccess: false,
      iterations: 0,
      durationMs: Date.now() - startTime,
      inputTokens: 0,
      outputTokens: 0,
      failedChecks: [`执行异常: ${err.message}`],
    };
  } finally {
    if (workDir) cleanupFixture(workDir);
  }
}

// ====== 主流程 ======

async function main() {
  const args = process.argv.slice(2);
  const provider = getArg(args, '--provider') ?? 'ccclaw';
  const model = getArg(args, '--model') ?? 'qwen-max';
  const casesFilter = getArg(args, '--cases') as Difficulty | undefined;

  console.log(`🎯 评测开始: ${provider} / ${model}`);
  console.log(`   用例过滤: ${casesFilter ?? '全部'}\n`);

  const cases = loadCases(casesFilter);
  if (cases.length === 0) {
    console.log('❌ 未找到用例。请在 tests/eval/cases/ 目录下添加用例 JSON。');
    process.exit(1);
  }

  console.log(`📋 共 ${cases.length} 个用例\n`);

  const results: EvalResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  ${c.id}: ${c.name} ... `);
    const result = await runCase(c);
    const icon = result.finalSuccess ? '✅' : '❌';
    console.log(`${icon} (${(result.durationMs / 1000).toFixed(1)}s)`);
    results.push(result);
  }

  const summary = computeSummary(results);
  const report: EvalReport = {
    provider,
    model,
    timestamp: new Date().toISOString(),
    results,
    summary,
  };

  // 输出报告
  const markdown = generateReport(report);
  console.log('\n' + markdown);

  // 保存到文件
  const reportPath = join(EVAL_DIR, `report-${provider}-${model}-${Date.now()}.md`);
  writeFileSync(reportPath, markdown);
  console.log(`\n📄 报告已保存: ${reportPath}`);

  // 保存 JSON
  const jsonPath = join(EVAL_DIR, `report-${provider}-${model}-${Date.now()}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch(console.error);
