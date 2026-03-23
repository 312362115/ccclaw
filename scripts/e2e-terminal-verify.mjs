#!/usr/bin/env node
/**
 * Terminal 端到端验证
 * 验证：terminal_open → terminal_input → terminal_output → terminal_close
 * 通过 RELAY WebSocket（/ws）测试
 */

const BASE = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3000/ws';
const ADMIN_EMAIL = 'admin@ccclaw.test';
const ADMIN_PASSWORD = 'test1234pass';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function log(step, msg) { console.log(`${cyan(`[${step}]`)} ${msg}`); }
function pass(step) { console.log(`${green('✓')} ${step}`); }
function fail(step, err) { console.log(`${red('✗')} ${step}: ${err}`); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/** 触发 Runner 启动（通过 RELAY 聊天） */
function triggerRunner(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('超时')); }, 30_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'auth_ok') ws.send(JSON.stringify({ type: 'message', workspaceId, sessionId: `trigger-${Date.now()}`, content: 'ping' }));
      if (msg.type === 'text_delta' || msg.type === 'done' || msg.type === 'error') { clearTimeout(timeout); ws.close(); resolve(); }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'error')); });
  });
}

async function run() {
  console.log('\n' + yellow('=== Terminal 端到端验证 ===') + '\n');
  let workspaceId = null, token = null;

  try {
    // 1. 登录 + 创建 Workspace + 启动 Runner
    log('1/4', '环境准备...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;

    const wsRes = await api('POST', '/api/workspaces', {
      name: `terminal-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;

    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    // 等待 Runner 注册 directUrl（说明 binding 已建立）
    for (let i = 0; i < 10; i++) {
      const info = await api('GET', `/api/workspaces/${workspaceId}/runner-info`, null, token);
      if (info.status === 200 && info.data.directUrl) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    pass(`环境就绪: workspace=${workspaceId}`);

    // 2. 连接 RELAY WebSocket + 认证
    log('2/4', 'RELAY WebSocket 连接...');
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS 连接超时')), 5000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_ok') { clearTimeout(timeout); resolve(); }
      });
      ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'error')); });
    });
    pass('RELAY 认证成功');

    // 3. Terminal 操作
    log('3/4', 'Terminal 打开 + 执行命令...');
    const sessionId = `term-session-${Date.now()}`;

    // 收集 terminal_output
    const outputs = [];
    const outputHandler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        outputs.push(msg.data);
      }
    };
    ws.addEventListener('message', outputHandler);

    // 确认 Runner 在线
    const infoRes = await api('GET', `/api/workspaces/${workspaceId}/runner-info`, null, token);
    if (infoRes.status !== 200) {
      fail('Runner 不在线', JSON.stringify(infoRes.data));
      ws.close();
      return;
    }
    console.log(`  Runner directUrl: ${infoRes.data.directUrl}`);

    // 打开终端
    ws.send(JSON.stringify({
      type: 'terminal_open',
      workspaceId,
      sessionId,
      cols: 80,
      rows: 24,
    }));

    // 等待终端就绪（收到 shell prompt）
    await new Promise(r => setTimeout(r, 2000));

    if (outputs.length > 0) {
      pass(`Terminal 打开成功，收到 ${outputs.length} 条输出`);
    } else {
      console.log(`  ${yellow('⚠')} 未收到初始输出（可能 shell 静默启动）`);
    }

    // 发送命令
    const testCommand = 'echo "TERMINAL_E2E_TEST_OK"\n';
    ws.send(JSON.stringify({
      type: 'terminal_input',
      workspaceId,
      sessionId,
      data: testCommand,
    }));

    // 等待输出
    await new Promise(r => setTimeout(r, 2000));

    const allOutput = outputs.join('');
    if (allOutput.includes('TERMINAL_E2E_TEST_OK')) {
      pass(`命令执行成功，输出包含预期标记`);
    } else {
      fail('命令输出', `未找到 "TERMINAL_E2E_TEST_OK"，实际输出: ${allOutput.slice(0, 200)}`);
    }

    // 发送 pwd 验证工作目录
    outputs.length = 0;
    ws.send(JSON.stringify({
      type: 'terminal_input',
      workspaceId,
      sessionId,
      data: 'pwd\n',
    }));
    await new Promise(r => setTimeout(r, 1000));

    const pwdOutput = outputs.join('');
    console.log(`  pwd 输出: ${pwdOutput.replace(/\n/g, '\\n').slice(0, 100)}`);

    // 关闭终端
    ws.send(JSON.stringify({
      type: 'terminal_close',
      workspaceId,
      sessionId,
    }));
    await new Promise(r => setTimeout(r, 500));
    pass('Terminal 关闭');

    ws.removeEventListener('message', outputHandler);
    ws.close();

    // 4. 结果
    log('4/4', '验证结果...');
    console.log(`  总输出条数: ${outputs.length + allOutput.split('\n').length}`);
    console.log('\n' + green('=== Terminal 验证完成 ===') + '\n');

  } catch (err) {
    fail('异常', err.message);
    console.error(err);
  } finally {
    if (workspaceId && token) {
      await api('DELETE', `/api/workspaces/${workspaceId}`, null, token);
      pass('清理完成');
    }
  }
}

run().catch((err) => {
  console.error(red('脚本异常:'), err);
  process.exit(1);
});
