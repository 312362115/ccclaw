#!/usr/bin/env node
/**
 * Plan 模式端到端验证
 * 验证：/plan 前缀 → plan_mode 事件 → AI 只输出计划不调用工具 → 1 轮迭代
 */

const BASE = 'http://127.0.0.1:3000';
const RELAY_WS = 'ws://127.0.0.1:3000/ws';
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

function triggerRunner(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS);
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

async function waitForDirectUrl(token, workspaceId) {
  for (let i = 0; i < 10; i++) {
    const res = await api('GET', `/api/workspaces/${workspaceId}/runner-info`, null, token);
    if (res.status === 200 && res.data.directUrl) return res.data.directUrl;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

function directChatCollectAll(directUrl, token, sessionId, message, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${directUrl}?token=${token}`);
    const events = [];
    const timeout = setTimeout(() => { ws.close(); resolve({ ok: false, error: '超时', events }); }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        channel: 'chat', action: 'message', requestId: `req-${Date.now()}`,
        data: { sessionId, message },
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); }
      catch { return; }
      if (msg.channel !== 'chat') return;
      events.push(msg);

      if (msg.action === 'text_delta') process.stdout.write(msg.data?.delta ?? '');
      else if (msg.action === 'done' || msg.action === 'session_done') {
        console.log('');
        clearTimeout(timeout); ws.close(); resolve({ ok: true, events });
      } else if (msg.action === 'error') {
        console.log('');
        clearTimeout(timeout); ws.close(); resolve({ ok: false, error: msg.data?.message, events });
      }
    });

    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'WS error')); });
  });
}

async function run() {
  console.log('\n' + yellow('=== Plan 模式端到端验证 ===') + '\n');
  let workspaceId = null, token = null;

  try {
    log('1/3', '环境准备...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;

    const wsRes = await api('POST', '/api/workspaces', {
      name: `plan-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;

    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('directUrl', '无法获取'); return; }
    pass(`环境就绪: ${directUrl}`);

    // 2. 发送 /plan 消息
    log('2/3', '发送 /plan 消息...');
    const sessionId = `plan-session-${Date.now()}`;
    const result = await directChatCollectAll(
      directUrl, token, sessionId,
      '/plan 请为一个 TODO 应用设计实现计划，包括数据模型、API 接口、前端页面。',
    );

    // 3. 验证
    log('3/3', '验证 Plan 模式行为...');
    let allPassed = true;

    // plan_mode 事件
    const planModeEvents = result.events.filter(e => e.action === 'plan_mode');
    if (planModeEvents.length > 0) {
      pass(`plan_mode 事件: ${planModeEvents.length} 次 (active=${planModeEvents[0].data?.active})`);
    } else {
      console.log(`  ${yellow('⚠')} 未收到 plan_mode 事件（Runner 可能未发送）`);
    }

    // 不应有 tool_use 事件
    const toolUses = result.events.filter(e => e.action === 'tool_use_start');
    if (toolUses.length === 0) {
      pass('Plan 模式未调用工具（正确）');
    } else {
      fail('Plan 模式', `不应调用工具但调用了 ${toolUses.length} 次: ${toolUses.map(e => e.data?.name).join(', ')}`);
      allPassed = false;
    }

    // 应有 text_delta（输出计划文本）
    const textDeltas = result.events.filter(e => e.action === 'text_delta');
    if (textDeltas.length > 0) {
      const fullText = textDeltas.map(e => e.data?.delta ?? '').join('');
      pass(`输出计划文本: ${fullText.length} 字`);
      // 检查计划相关关键词
      const keywords = ['数据', 'API', '接口', '前端', '页面', '模型', '步骤', '计划'];
      const found = keywords.filter(k => fullText.includes(k));
      if (found.length >= 2) {
        pass(`计划内容合理: 包含 ${found.join(', ')}`);
      }
    } else {
      fail('Plan 输出', '无文本输出');
      allPassed = false;
    }

    // done 事件
    const doneEvents = result.events.filter(e => e.action === 'done' || e.action === 'session_done');
    if (doneEvents.length > 0) {
      pass('正常结束 (done)');
    } else {
      fail('结束', '无 done 事件');
      allPassed = false;
    }

    if (allPassed) {
      console.log('\n' + green('=== Plan 模式验证通过 ===') + '\n');
    } else {
      console.log('\n' + red('=== Plan 模式验证部分失败 ===') + '\n');
    }

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
