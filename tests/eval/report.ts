/**
 * Report — 评测报告生成
 *
 * 输出 Markdown 格式的对比报告。
 */

import type { EvalReport, EvalResult, EvalSummary, Difficulty } from './types.js';

/** 从结果列表计算汇总 */
export function computeSummary(results: EvalResult[]): EvalSummary {
  const total = results.length;
  const firstPassCount = results.filter(r => r.firstPassSuccess).length;
  const finalPassCount = results.filter(r => r.finalSuccess).length;

  const avgIterations = total > 0
    ? results.reduce((s, r) => s + r.iterations, 0) / total
    : 0;
  const avgDurationMs = total > 0
    ? results.reduce((s, r) => s + r.durationMs, 0) / total
    : 0;

  const difficulties: Difficulty[] = ['simple', 'medium', 'complex'];
  const byDifficulty: Record<string, { total: number; firstPassRate: number; finalPassRate: number }> = {};

  for (const d of difficulties) {
    const subset = results.filter(r => r.difficulty === d);
    byDifficulty[d] = {
      total: subset.length,
      firstPassRate: subset.length > 0
        ? subset.filter(r => r.firstPassSuccess).length / subset.length
        : 0,
      finalPassRate: subset.length > 0
        ? subset.filter(r => r.finalSuccess).length / subset.length
        : 0,
    };
  }

  return {
    total,
    firstPassRate: total > 0 ? firstPassCount / total : 0,
    finalPassRate: total > 0 ? finalPassCount / total : 0,
    avgIterations: Math.round(avgIterations * 10) / 10,
    avgDurationMs: Math.round(avgDurationMs),
    totalInputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
    byDifficulty: byDifficulty as EvalSummary['byDifficulty'],
  };
}

/** 生成 Markdown 评测报告 */
export function generateReport(report: EvalReport): string {
  const { provider, model, timestamp, results, summary } = report;
  const lines: string[] = [];

  lines.push(`# 评测报告`);
  lines.push('');
  lines.push(`- **Provider**: ${provider}`);
  lines.push(`- **Model**: ${model}`);
  lines.push(`- **时间**: ${timestamp}`);
  lines.push(`- **用例数**: ${summary.total}`);
  lines.push('');

  // 总览
  lines.push(`## 总览`);
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 一次成功率 | ${pct(summary.firstPassRate)} |`);
  lines.push(`| 最终成功率 | ${pct(summary.finalPassRate)} |`);
  lines.push(`| 平均轮次 | ${summary.avgIterations} |`);
  lines.push(`| 平均耗时 | ${(summary.avgDurationMs / 1000).toFixed(1)}s |`);
  lines.push(`| 总 Input Token | ${summary.totalInputTokens.toLocaleString()} |`);
  lines.push(`| 总 Output Token | ${summary.totalOutputTokens.toLocaleString()} |`);
  lines.push('');

  // 分难度
  lines.push(`## 分难度`);
  lines.push('');
  lines.push(`| 难度 | 用例数 | 一次成功率 | 最终成功率 |`);
  lines.push(`|------|--------|-----------|-----------|`);
  for (const d of ['simple', 'medium', 'complex'] as Difficulty[]) {
    const s = summary.byDifficulty[d];
    lines.push(`| ${d} | ${s.total} | ${pct(s.firstPassRate)} | ${pct(s.finalPassRate)} |`);
  }
  lines.push('');

  // 详细结果
  lines.push(`## 详细结果`);
  lines.push('');
  lines.push(`| ID | 名称 | 难度 | 首次 | 最终 | 轮次 | 耗时 | 失败原因 |`);
  lines.push(`|----|------|------|------|------|------|------|---------|`);
  for (const r of results) {
    const firstPass = r.firstPassSuccess ? '✅' : '❌';
    const finalPass = r.finalSuccess ? '✅' : '❌';
    const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
    const failed = r.failedChecks.length > 0 ? r.failedChecks[0].slice(0, 50) : '-';
    lines.push(`| ${r.caseId} | ${r.caseName} | ${r.difficulty} | ${firstPass} | ${finalPass} | ${r.iterations} | ${duration} | ${failed} |`);
  }

  return lines.join('\n');
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

/** 生成两个报告的对比 */
export function generateComparison(baseline: EvalReport, current: EvalReport): string {
  const lines: string[] = [];

  lines.push(`# 评测对比`);
  lines.push('');
  lines.push(`| 指标 | ${baseline.model} (基线) | ${current.model} (当前) | 变化 |`);
  lines.push(`|------|---------|---------|------|`);
  lines.push(`| 一次成功率 | ${pct(baseline.summary.firstPassRate)} | ${pct(current.summary.firstPassRate)} | ${delta(baseline.summary.firstPassRate, current.summary.firstPassRate)} |`);
  lines.push(`| 最终成功率 | ${pct(baseline.summary.finalPassRate)} | ${pct(current.summary.finalPassRate)} | ${delta(baseline.summary.finalPassRate, current.summary.finalPassRate)} |`);
  lines.push(`| 平均轮次 | ${baseline.summary.avgIterations} | ${current.summary.avgIterations} | ${deltaNum(baseline.summary.avgIterations, current.summary.avgIterations, true)} |`);
  lines.push(`| 平均耗时 | ${(baseline.summary.avgDurationMs / 1000).toFixed(1)}s | ${(current.summary.avgDurationMs / 1000).toFixed(1)}s | ${deltaNum(baseline.summary.avgDurationMs, current.summary.avgDurationMs, true)} |`);

  return lines.join('\n');
}

function delta(base: number, curr: number): string {
  const diff = curr - base;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${(diff * 100).toFixed(0)}pp`;
}

function deltaNum(base: number, curr: number, lowerIsBetter: boolean): string {
  const diff = curr - base;
  const sign = diff >= 0 ? '+' : '';
  const indicator = lowerIsBetter ? (diff <= 0 ? '↓' : '↑') : (diff >= 0 ? '↑' : '↓');
  return `${sign}${diff.toFixed(1)} ${indicator}`;
}
