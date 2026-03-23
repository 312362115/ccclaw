#!/usr/bin/env node
/**
 * 直连路径端到端验证
 * 验证：登录 → 创建 Workspace → 启动 Runner → ensure-config → 获取 directUrl → 直连聊天
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

/** 通过 RELAY WebSocket 发一条消息触发 Runner 启动，等待 Runner ready */
function triggerRunnerViaRelay(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('RELAY 触发 Runner 超时(30s)')); }, 30_000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'auth_ok') {
        // 发一条消息触发 ensureRunner
        ws.send(JSON.stringify({
          type: 'message',
          workspaceId,
          sessionId: `trigger-${Date.now()}`,
          content: 'ping',
        }));
      }
      // 收到任何响应（text_delta/done/error）说明 Runner 已启动
      if (msg.type === 'text_delta' || msg.type === 'done' || msg.type === 'error') {
        clearTimeout(timeout);
        ws.close();
        resolve(msg);
      }
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message || 'RELAY WS error'));
    });
  });
}

/** 等待 runner-info 返回 directUrl（Runner 启动后需要一点时间注册） */
async function waitForDirectUrl(token, workspaceId, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await api('GET', `/api/workspaces/${workspaceId}/runner-info`, null, token);
    if (res.status === 200 && res.data.directUrl) {
      return res.data;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/** 通过 DirectServer 发聊天消息 */
function directChat(directUrl, token, sessionId, message) {
  return new Promise((resolve, reject) => {
    // 直连用 ws 库的 URL 格式，加 token query param
    const url = `${directUrl}?token=${token}`;
    const ws = new WebSocket(url);
    const messages = [];
    const timeout = setTimeout(() => { ws.close(); reject(new Error('直连聊天超时(60s)')); }, 60_000);

    ws.addEventListener('open', () => {
      // 直连协议：channel/action 格式
      ws.send(JSON.stringify({
        channel: 'chat',
        action: 'message',
        requestId: `req-${Date.now()}`,
        data: { sessionId, message },
      }));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      messages.push(msg);

      if (msg.channel === 'chat') {
        if (msg.action === 'text_delta') {
          const delta = msg.data?.delta ?? msg.data?.content ?? '';
          process.stdout.write(delta);
        } else if (msg.action === 'done' || msg.action === 'session_done') {
          console.log(''); // 换行
          clearTimeout(timeout);
          ws.close();
          resolve({ ok: true, messages });
        } else if (msg.action === 'error') {
          console.log('');
          clearTimeout(timeout);
          ws.close();
          resolve({ ok: false, error: msg.data?.message || JSON.stringify(msg.data), messages });
        } else {
          // 其他事件类型
          console.log(`  ${dim(`[${msg.action}]`)} ${JSON.stringify(msg.data).slice(0, 120)}`);
        }
      }
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message || 'Direct WS error'));
    });

    ws.addEventListener('close', (event) => {
      if (!messages.length) {
        clearTimeout(timeout);
        reject(new Error(`直连关闭: code=${event.code} reason=${event.reason}`));
      }
    });
  });
}

async function run() {
  console.log('\n' + yellow('=== 直连路径 端到端验证 ===') + '\n');

  // 1. 登录
  log('1/7', '登录...');
  const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginRes.status !== 200) { fail('登录', JSON.stringify(loginRes.data)); process.exit(1); }
  const token = loginRes.data.accessToken;
  pass('登录成功');

  // 2. 创建 Workspace
  log('2/7', '创建 Workspace...');
  const wsRes = await api('POST', '/api/workspaces', {
    name: `direct-e2e-${Date.now()}`,
    settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
  }, token);
  if (wsRes.status !== 201 && wsRes.status !== 200) { fail('创建', JSON.stringify(wsRes.data)); process.exit(1); }
  const workspace = wsRes.data;
  pass(`Workspace: ${workspace.name} (${workspace.id})`);

  // 3. 通过 RELAY 触发 Runner 启动
  log('3/7', '触发 Runner 启动（via RELAY）...');
  try {
    const triggerResult = await triggerRunnerViaRelay(token, workspace.id);
    pass(`Runner 已启动，RELAY 收到: ${triggerResult.type}`);
  } catch (err) {
    fail('Runner 启动', err.message);
    await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
    process.exit(1);
  }

  // 4. ensure-config 推送配置
  log('4/7', '推送 Provider 配置 (ensure-config)...');
  const configRes = await api('POST', `/api/workspaces/${workspace.id}/ensure-config`, null, token);
  if (configRes.status !== 200) {
    fail('ensure-config', JSON.stringify(configRes.data));
    await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
    process.exit(1);
  }
  pass('ensure-config 成功');

  // 5. 获取 directUrl
  log('5/7', '获取 Runner directUrl...');
  const runnerInfo = await waitForDirectUrl(token, workspace.id);
  if (!runnerInfo) {
    fail('directUrl', 'Runner 未注册 directUrl（可能不支持直连）');
    await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
    process.exit(1);
  }
  pass(`directUrl: ${runnerInfo.directUrl}`);

  // 6. 直连聊天
  log('6/7', `直连聊天 (${runnerInfo.directUrl})...`);
  const sessionId = `direct-session-${Date.now()}`;
  try {
    const chatResult = await directChat(runnerInfo.directUrl, token, sessionId, '你好，请用一句话介绍你自己。');

    // 7. 验证结果
    log('7/7', '验证结果...');
    if (chatResult.ok) {
      const textMsgs = chatResult.messages.filter(m => m.channel === 'chat' && m.action === 'text_delta');
      const fullText = textMsgs.map(m => m.data?.delta ?? m.data?.content ?? '').join('');
      pass('直连聊天验证通过！');
      console.log(`  AI 回复: ${fullText.slice(0, 200)}${fullText.length > 200 ? '...' : ''}`);
      console.log(`  消息数: ${chatResult.messages.length} (text_delta: ${textMsgs.length})`);

      // 检查关键字段
      const doneMsgs = chatResult.messages.filter(m => m.action === 'done' || m.action === 'session_done');
      const hasSessionId = textMsgs.every(m => m.data?.sessionId === sessionId);
      console.log(`  sessionId 一致: ${hasSessionId ? green('是') : red('否')}`);
      console.log(`  done 消息: ${doneMsgs.length > 0 ? green('有') : red('无')}`);
    } else {
      fail('直连聊天', chatResult.error);
      if (chatResult.messages?.length) {
        for (const m of chatResult.messages.slice(0, 5)) {
          console.log(`    ${m.action}: ${JSON.stringify(m.data).slice(0, 150)}`);
        }
      }
    }
  } catch (err) {
    fail('直连聊天', err.message);
  }

  // 清理
  log('清理', '删除 Workspace...');
  await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
  pass('清理完成');

  console.log('\n' + yellow('=== 验证结束 ===') + '\n');
}

run().catch((err) => {
  console.error(red('脚本异常:'), err);
  process.exit(1);
});
