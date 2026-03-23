#!/usr/bin/env node
/**
 * CCCLaw 全量端到端回归测试
 *
 * 用法:
 *   node scripts/e2e-all.mjs          # 运行全部测试
 *   node scripts/e2e-all.mjs --quick  # 只运行快速测试（跳过长对话等耗时项）
 *   node scripts/e2e-all.mjs relay    # 只运行指定测试
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// 测试定义（按依赖顺序排列）
const ALL_TESTS = [
  { id: 'relay',       name: 'RELAY 路径聊天',         script: 'e2e-verify.mjs',             quick: true },
  { id: 'direct',      name: '直连路径聊天',           script: 'e2e-direct-verify.mjs',       quick: true },
  { id: 'tunnel',      name: 'Tunnel 回退路径聊天',    script: 'e2e-tunnel-verify.mjs',       quick: true },
  { id: 'file-sync',   name: '文件同步 CRUD + Watch',  script: 'e2e-file-sync-verify.mjs',    quick: true },
  { id: 'tool-call',   name: 'Tool Call 事件流',        script: 'e2e-tool-call-verify.mjs',    quick: true },
  { id: 'confirm',     name: 'Tool Confirm 流程',       script: 'e2e-confirm-verify.mjs',      quick: true },
  { id: 'terminal',    name: 'Terminal PTY',            script: 'e2e-terminal-verify.mjs',     quick: true },
  { id: 'consolidator',name: '上下文压缩（长对话）',     script: 'e2e-consolidator-verify.mjs', quick: false },
];

function runTest(test) {
  const scriptPath = resolve(__dirname, test.script);
  try {
    execFileSync('node', [scriptPath], {
      stdio: 'inherit',
      timeout: test.quick ? 120_000 : 600_000,
      cwd: resolve(__dirname, '..'),
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const quickMode = args.includes('--quick');
  const filterIds = args.filter(a => !a.startsWith('--'));

  let tests = ALL_TESTS;
  if (filterIds.length > 0) {
    tests = ALL_TESTS.filter(t => filterIds.includes(t.id));
    if (tests.length === 0) {
      console.error(`未找到测试: ${filterIds.join(', ')}`);
      console.error(`可用测试: ${ALL_TESTS.map(t => t.id).join(', ')}`);
      process.exit(1);
    }
  } else if (quickMode) {
    tests = ALL_TESTS.filter(t => t.quick);
  }

  console.log('\n' + bold(yellow('╔══════════════════════════════════════════╗')));
  console.log(bold(yellow('║   CCCLaw E2E 回归测试                    ║')));
  console.log(bold(yellow('╚══════════════════════════════════════════╝')) + '\n');
  console.log(`  模式: ${quickMode ? yellow('快速（跳过耗时测试）') : cyan('全量')}`);
  console.log(`  测试: ${tests.length} 项\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const label = `[${i + 1}/${tests.length}] ${test.name}`;
    console.log(bold(`\n${'─'.repeat(50)}`));
    console.log(bold(`${label}`));
    console.log(bold(`${'─'.repeat(50)}`));

    const testStart = Date.now();
    const passed = runTest(test);
    const duration = ((Date.now() - testStart) / 1000).toFixed(1);

    results.push({ ...test, passed, duration });
  }

  // 汇总报告
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;

  console.log('\n' + bold(yellow('═'.repeat(50))));
  console.log(bold('  测试报告\n'));

  for (const r of results) {
    const icon = r.passed ? green('✓') : red('✗');
    console.log(`  ${icon} ${r.name.padEnd(25)} ${r.duration}s`);
  }

  console.log(`\n  总计: ${results.length} | ${green(`通过: ${passCount}`)} | ${failCount > 0 ? red(`失败: ${failCount}`) : `失败: 0`}`);
  console.log(`  耗时: ${totalDuration}s\n`);

  if (failCount > 0) {
    console.log(red('  有测试失败！\n'));
    process.exit(1);
  } else {
    console.log(green('  全部通过！\n'));
  }
}

main();
