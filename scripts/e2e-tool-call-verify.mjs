#!/usr/bin/env node
/**
 * Tool Call 端到端验证
 * 验证：AI 使用工具（bash/read/write）时，前端能收到完整的 tool_use 事件流
 * 通过直连路径测试
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

function triggerRunner(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('超时')); }, 30_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ type: 'message', workspaceId, sessionId: `trigger-${Date.now()}`, content: 'ping' }));
      }
      if (msg.type === 'text_delta' || msg.type === 'done' || msg.type === 'error') {
        clearTimeout(timeout); ws.close(); resolve();
      }
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

/** 通过直连发聊天并收集所有事件（包括 tool_use） */
function directChatCollectAll(directUrl, token, sessionId, message, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${directUrl}?token=${token}`);
    const events = [];
    const timeout = setTimeout(() => { ws.close(); resolve({ ok: false, error: '超时', events }); }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        channel: 'chat',
        action: 'message',
        requestId: `req-${Date.now()}`,
        data: { sessionId, message },
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); }
      catch { return; }

      if (msg.channel !== 'chat') return; // 忽略 tree 等广播

      events.push(msg);
      const action = msg.action;

      if (action === 'text_delta') {
        process.stdout.write(msg.data?.delta ?? '');
      } else if (action === 'tool_use_start') {
        console.log(`\n  ${cyan('🔧 tool_use_start')}: ${msg.data?.name || msg.data?.tool || 'unknown'}`);
      } else if (action === 'tool_use_delta') {
        // 工具输入参数流式传输，不打印以免噪音
      } else if (action === 'tool_use_end') {
        console.log(`  ${cyan('🔧 tool_use_end')}: id=${msg.data?.toolCallId?.slice(0, 12) || '?'}...`);
      } else if (action === 'tool_result') {
        const output = msg.data?.output ?? '';
        console.log(`  ${green('📋 tool_result')}: ${String(output).slice(0, 100)}${output.length > 100 ? '...' : ''}`);
      } else if (action === 'done' || action === 'session_done') {
        console.log('');
        clearTimeout(timeout);
        ws.close();
        resolve({ ok: true, events });
      } else if (action === 'error') {
        console.log('');
        clearTimeout(timeout);
        ws.close();
        resolve({ ok: false, error: msg.data?.message || JSON.stringify(msg.data), events });
      } else {
        console.log(`  ${dim(`[${action}]`)} ${JSON.stringify(msg.data).slice(0, 100)}`);
      }
    });

    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'WS error')); });
  });
}

async function run() {
  console.log('\n' + yellow('=== Tool Call 端到端验证 ===') + '\n');
  let workspaceId = null;
  let token = null;

  try {
    // 1. 登录
    log('1/5', '登录...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (loginRes.status !== 200) { fail('登录', JSON.stringify(loginRes.data)); process.exit(1); }
    token = loginRes.data.accessToken;
    pass('登录成功');

    // 2. 创建 Workspace
    log('2/5', '创建 Workspace...');
    const wsRes = await api('POST', '/api/workspaces', {
      name: `tool-call-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    if (wsRes.status !== 201 && wsRes.status !== 200) { fail('创建', JSON.stringify(wsRes.data)); process.exit(1); }
    workspaceId = wsRes.data.id;
    pass(`Workspace: ${wsRes.data.name}`);

    // 3. 启动 Runner + 获取 directUrl
    log('3/5', '启动 Runner...');
    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('directUrl', '无法获取'); process.exit(1); }
    pass(`Runner 就绪: ${directUrl}`);

    // 4. 发送需要使用工具的提示
    log('4/5', '发送需要工具调用的消息...');
    console.log(dim('  提示: "在工作区创建一个 hello.txt 文件，内容写 Hello World，然后读取它确认内容正确"\n'));

    const sessionId = `tool-session-${Date.now()}`;
    const result = await directChatCollectAll(
      directUrl, token, sessionId,
      '请在工作区根目录创建一个名为 hello.txt 的文件，内容为 "Hello World"，然后读取它确认内容正确。只需要完成这两步即可。',
    );

    // 5. 验证结果
    log('5/5', '验证 Tool Call 事件流...');
    if (!result.ok) {
      fail('聊天', result.error);
      process.exit(1);
    }

    const toolStarts = result.events.filter(e => e.action === 'tool_use_start');
    const toolEnds = result.events.filter(e => e.action === 'tool_use_end');
    const toolResults = result.events.filter(e => e.action === 'tool_result');
    const textDeltas = result.events.filter(e => e.action === 'text_delta');
    const doneEvents = result.events.filter(e => e.action === 'done' || e.action === 'session_done');

    console.log(`\n  事件统计:`);
    console.log(`    text_delta:     ${textDeltas.length}`);
    console.log(`    tool_use_start: ${toolStarts.length}`);
    console.log(`    tool_use_end:   ${toolEnds.length}`);
    console.log(`    tool_result:    ${toolResults.length}`);
    console.log(`    done:           ${doneEvents.length}`);

    // 验证关键点
    let allPassed = true;

    if (toolStarts.length > 0) {
      pass(`工具调用触发: ${toolStarts.length} 次 (${toolStarts.map(e => e.data?.name || e.data?.tool || '?').join(', ')})`);
    } else {
      fail('工具调用', 'AI 没有使用任何工具');
      allPassed = false;
    }

    if (toolStarts.length === toolEnds.length) {
      pass(`tool_use_start/end 配对一致: ${toolStarts.length} 对`);
    } else {
      fail('配对', `start=${toolStarts.length} end=${toolEnds.length} 不匹配`);
      allPassed = false;
    }

    if (toolResults.length > 0) {
      pass(`工具结果返回: ${toolResults.length} 个`);
    } else {
      fail('工具结果', '没有收到 tool_result');
      allPassed = false;
    }

    if (doneEvents.length > 0) {
      pass('对话正常结束 (done)');
    } else {
      fail('结束', '没有收到 done 事件');
      allPassed = false;
    }

    // 检查 sessionId 一致性
    const allHaveSessionId = result.events.every(e => e.data?.sessionId === sessionId);
    if (allHaveSessionId) {
      pass('所有事件 sessionId 一致');
    } else {
      const mismatched = result.events.filter(e => e.data?.sessionId !== sessionId);
      console.log(`  ${yellow('⚠')} ${mismatched.length} 个事件 sessionId 不一致`);
    }

    if (allPassed) {
      console.log('\n' + green('=== Tool Call 验证通过 ===') + '\n');
    } else {
      console.log('\n' + red('=== Tool Call 验证部分失败 ===') + '\n');
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
