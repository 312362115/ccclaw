#!/usr/bin/env node
/**
 * Sub-agent（spawn）端到端验证
 * 验证：主 Agent 使用 spawn 工具派生子 Agent → 子 Agent 执行任务 → 结果回传
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

function directChatCollectAll(directUrl, token, sessionId, message, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${directUrl}?token=${token}`);
    const events = [];
    const timeout = setTimeout(() => { ws.close(); resolve({ ok: false, error: '超时', events }); }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        channel: 'chat', action: 'message',
        requestId: `req-${Date.now()}`,
        data: { sessionId, message },
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); }
      catch { return; }
      if (msg.channel !== 'chat') return;
      events.push(msg);

      if (msg.action === 'text_delta') {
        process.stdout.write(msg.data?.delta ?? '');
      } else if (msg.action === 'tool_use_start') {
        console.log(`\n  ${cyan('🔧')} ${msg.data?.name || '?'}`);
      } else if (msg.action === 'tool_result') {
        const output = msg.data?.output ?? '';
        console.log(`  ${green('📋')} ${String(output).slice(0, 150)}${output.length > 150 ? '...' : ''}`);
      } else if (msg.action === 'subagent_started') {
        console.log(`  ${yellow('🚀 subagent_started')}: ${msg.data?.label || '?'}`);
      } else if (msg.action === 'subagent_result') {
        console.log(`  ${green('✅ subagent_result')}: ${JSON.stringify(msg.data).slice(0, 150)}`);
      } else if (msg.action === 'done' || msg.action === 'session_done') {
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
  console.log('\n' + yellow('=== Sub-agent（spawn）端到端验证 ===') + '\n');
  let workspaceId = null, token = null;

  try {
    log('1/4', '环境准备...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;

    const wsRes = await api('POST', '/api/workspaces', {
      name: `subagent-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;

    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('directUrl', '无法获取'); return; }
    pass(`环境就绪: ${directUrl}`);

    // 2. 让 AI 使用 spawn 工具
    log('2/4', '请求 AI 使用 spawn 派生子 Agent...');
    console.log(dim('  提示: 明确要求使用 spawn 工具\n'));

    const sessionId = `subagent-session-${Date.now()}`;
    const result = await directChatCollectAll(
      directUrl, token, sessionId,
      '请使用 spawn 工具派生一个子 Agent，task 内容为"在工作区创建一个 subagent-test.txt 文件，内容为 SUBAGENT_OK"，label 为"file-creator"。执行完后告诉我结果。',
    );

    // 3. 分析结果
    log('3/4', '分析事件...');
    if (!result.ok) {
      fail('聊天', result.error);
    }

    const spawnStarts = result.events.filter(e => e.action === 'tool_use_start' && e.data?.name === 'spawn');
    const spawnResults = result.events.filter(e => e.action === 'tool_result' && String(e.data?.output ?? '').includes('子 Agent'));
    const subagentStarted = result.events.filter(e => e.action === 'subagent_started');
    const subagentResult = result.events.filter(e => e.action === 'subagent_result');

    console.log(`\n  spawn tool_use_start: ${spawnStarts.length}`);
    console.log(`  spawn tool_result:    ${spawnResults.length}`);
    console.log(`  subagent_started:     ${subagentStarted.length}`);
    console.log(`  subagent_result:      ${subagentResult.length}`);

    if (spawnStarts.length > 0) {
      pass('AI 使用了 spawn 工具');
    } else {
      fail('spawn', 'AI 未使用 spawn 工具');
      // 列出实际使用的工具
      const tools = result.events.filter(e => e.action === 'tool_use_start');
      if (tools.length) console.log(`    实际使用: ${tools.map(e => e.data?.name).join(', ')}`);
    }

    if (spawnResults.length > 0) {
      const output = spawnResults[0].data?.output || '';
      if (output.includes('完成') || output.includes('SUBAGENT_OK') || output.includes('file-creator')) {
        pass(`子 Agent 执行完成`);
        console.log(`    结果: ${output.slice(0, 200)}`);
      } else {
        console.log(`  ${yellow('⚠')} spawn result: ${output.slice(0, 200)}`);
      }
    }

    // 4. 验证文件是否创建
    log('4/4', '验证子 Agent 创建的文件...');
    const fileWs = new WebSocket(`${directUrl}?token=${token}`);
    await new Promise(r => fileWs.addEventListener('open', r));

    const fileCheck = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 5000);
      const reqId = `check-${Date.now()}`;
      fileWs.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.requestId === reqId) { clearTimeout(t); resolve(msg); }
      });
      fileWs.send(JSON.stringify({
        channel: 'file', action: 'read', requestId: reqId,
        data: { path: 'subagent-test.txt' },
      }));
    });
    fileWs.close();

    if (fileCheck?.data?.content?.includes('SUBAGENT_OK')) {
      pass('子 Agent 文件创建成功，内容正确');
    } else if (fileCheck?.data?.content) {
      console.log(`  ${yellow('⚠')} 文件存在但内容: ${fileCheck.data.content.slice(0, 100)}`);
    } else {
      console.log(`  ${yellow('⚠')} 文件不存在（子 Agent 可能未执行文件创建）`);
    }

    console.log('\n' + yellow('=== Sub-agent 验证结束 ===') + '\n');

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
