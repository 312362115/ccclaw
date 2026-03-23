#!/usr/bin/env node
/**
 * Tunnel 回退路径端到端验证
 * 验证：登录 → 创建 Workspace → 启动 Runner → ensure-config → Tunnel WS 连接 → 聊天
 */

const BASE = 'http://127.0.0.1:3000';
const RELAY_WS = 'ws://127.0.0.1:3000/ws';
const ADMIN_EMAIL = 'admin@ccclaw.test';
const ADMIN_PASSWORD = 'test1234pass';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function log(step, msg) { console.log(`${cyan(`[${step}]`)} ${msg}`); }
function pass(step) { console.log(`${green('✓')} ${step}`); }
function fail(step, err) { console.log(`${red('✗')} ${step}: ${err}`); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/** 通过 RELAY 触发 Runner 启动 */
function triggerRunnerViaRelay(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('RELAY 触发超时')); }, 30_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ type: 'message', workspaceId, sessionId: `trigger-${Date.now()}`, content: 'ping' }));
      }
      if (msg.type === 'text_delta' || msg.type === 'done' || msg.type === 'error') {
        clearTimeout(timeout); ws.close(); resolve(msg);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'error')); });
  });
}

/** 通过 Tunnel WebSocket 发聊天消息 */
function tunnelChat(token, workspaceId, sessionId, message) {
  const tunnelUrl = `ws://127.0.0.1:3000/ws/tunnel?token=${token}&workspaceId=${workspaceId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(tunnelUrl);
    const messages = [];
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Tunnel 聊天超时(60s)')); }, 60_000);

    ws.addEventListener('open', () => {
      log('tunnel', 'Tunnel WebSocket 连接成功');
      // Tunnel 使用和直连相同的 DirectMessage 协议
      ws.send(JSON.stringify({
        channel: 'chat',
        action: 'message',
        requestId: `req-${Date.now()}`,
        data: { sessionId, message },
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        msg = JSON.parse(text);
      } catch (err) {
        console.log(`  ${red('parse error')}: ${String(event.data).slice(0, 200)}`);
        return;
      }
      messages.push(msg);

      if (msg.channel === 'chat') {
        if (msg.action === 'text_delta') {
          const delta = msg.data?.delta ?? msg.data?.content ?? '';
          process.stdout.write(delta);
        } else if (msg.action === 'done' || msg.action === 'session_done') {
          console.log('');
          clearTimeout(timeout); ws.close();
          resolve({ ok: true, messages });
        } else if (msg.action === 'error') {
          console.log('');
          clearTimeout(timeout); ws.close();
          resolve({ ok: false, error: msg.data?.message || JSON.stringify(msg.data), messages });
        } else {
          console.log(`  ${dim(`[${msg.action}]`)} ${JSON.stringify(msg.data).slice(0, 120)}`);
        }
      } else if (msg.channel === 'tree') {
        // 文件树广播，忽略
      } else {
        console.log(`  ${dim(`[${msg.channel}/${msg.action}]`)} ${JSON.stringify(msg.data).slice(0, 80)}`);
      }
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message || 'Tunnel WS error'));
    });

    ws.addEventListener('close', (event) => {
      if (!messages.length) {
        clearTimeout(timeout);
        reject(new Error(`Tunnel 关闭: code=${event.code} reason=${event.reason}`));
      }
    });
  });
}

async function run() {
  console.log('\n' + yellow('=== Tunnel 回退路径 端到端验证 ===') + '\n');

  // 1. 登录
  log('1/6', '登录...');
  const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginRes.status !== 200) { fail('登录', JSON.stringify(loginRes.data)); process.exit(1); }
  const token = loginRes.data.accessToken;
  pass('登录成功');

  // 2. 创建 Workspace
  log('2/6', '创建 Workspace...');
  const wsRes = await api('POST', '/api/workspaces', {
    name: `tunnel-e2e-${Date.now()}`,
    settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
  }, token);
  if (wsRes.status !== 201 && wsRes.status !== 200) { fail('创建', JSON.stringify(wsRes.data)); process.exit(1); }
  const workspace = wsRes.data;
  pass(`Workspace: ${workspace.name} (${workspace.id})`);

  // 3. 触发 Runner 启动
  log('3/6', '触发 Runner 启动（via RELAY）...');
  try {
    await triggerRunnerViaRelay(token, workspace.id);
    pass('Runner 已启动');
  } catch (err) {
    fail('Runner 启动', err.message);
    await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
    process.exit(1);
  }

  // 4. ensure-config
  log('4/6', '推送 Provider 配置...');
  const configRes = await api('POST', `/api/workspaces/${workspace.id}/ensure-config`, null, token);
  if (configRes.status !== 200) {
    fail('ensure-config', JSON.stringify(configRes.data));
    await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
    process.exit(1);
  }
  pass('ensure-config 成功');

  // 5. Tunnel 聊天
  log('5/6', 'Tunnel 路径聊天...');
  const sessionId = `tunnel-session-${Date.now()}`;
  let result;
  try {
    result = await tunnelChat(token, workspace.id, sessionId, '你好，请用一句话介绍你自己。');
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  // 6. 验证
  log('6/6', '验证结果...');
  if (result.ok) {
    const textMsgs = result.messages.filter(m => m.channel === 'chat' && m.action === 'text_delta');
    const fullText = textMsgs.map(m => m.data?.delta ?? m.data?.content ?? '').join('');
    const doneMsgs = result.messages.filter(m => m.action === 'done' || m.action === 'session_done');
    const hasSessionId = textMsgs.every(m => m.data?.sessionId === sessionId);

    pass('Tunnel 聊天验证通过！');
    console.log(`  AI 回复: ${fullText.slice(0, 200)}`);
    console.log(`  消息数: ${result.messages.length} (text_delta: ${textMsgs.length})`);
    console.log(`  sessionId 一致: ${hasSessionId ? green('是') : red('否')}`);
    console.log(`  done 消息: ${doneMsgs.length > 0 ? green('有') : red('无')}`);
  } else {
    fail('Tunnel 聊天', result.error);
    if (result.messages?.length) {
      for (const m of result.messages.slice(0, 5)) {
        console.log(`    ${m.channel}/${m.action}: ${JSON.stringify(m.data).slice(0, 150)}`);
      }
    }
  }

  // 清理
  log('清理', '删除 Workspace...');
  await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
  pass('清理完成');

  console.log('\n' + yellow('=== 验证结束 ===') + '\n');
  process.exit(result.ok ? 0 : 1);
}

run().catch((err) => {
  console.error(red('脚本异常:'), err);
  process.exit(1);
});
