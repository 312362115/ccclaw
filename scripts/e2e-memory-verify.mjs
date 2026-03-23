#!/usr/bin/env node
/**
 * Memory 工具端到端验证
 * 验证：memory_write → memory_read → memory_search → 跨 session 持久化
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

/** 发聊天并等待完成，收集 tool_result */
function directChat(directUrl, token, sessionId, message, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${directUrl}?token=${token}`);
    let fullText = '';
    const toolResults = [];
    const timeout = setTimeout(() => { ws.close(); resolve({ text: fullText, toolResults, error: '超时' }); }, timeoutMs);

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

      if (msg.action === 'text_delta') fullText += msg.data?.delta ?? '';
      else if (msg.action === 'tool_result') toolResults.push(msg.data?.output ?? '');
      else if (msg.action === 'done' || msg.action === 'session_done') {
        clearTimeout(timeout); ws.close(); resolve({ text: fullText, toolResults });
      } else if (msg.action === 'error') {
        clearTimeout(timeout); ws.close(); resolve({ text: fullText, toolResults, error: msg.data?.message });
      }
    });

    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'WS error')); });
  });
}

async function run() {
  console.log('\n' + yellow('=== Memory 工具端到端验证 ===') + '\n');
  let workspaceId = null, token = null;

  try {
    log('1/5', '环境准备...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;

    const wsRes = await api('POST', '/api/workspaces', {
      name: `memory-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;

    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('directUrl', '无法获取'); return; }
    pass(`环境就绪: ${directUrl}`);

    // 2. memory_write
    log('2/5', 'memory_write — 写入记忆...');
    const s1 = `mem-write-${Date.now()}`;
    const r1 = await directChat(directUrl, token, s1,
      '请使用 memory_write 工具写入一条记忆：name="e2e-test-decision", type="decision", content="E2E 验证项目使用 gemini-3-flash-preview 模型"。只调用工具不要多说。');

    const writeResult = r1.toolResults.find(r => r.includes('saved') || r.includes('Memory'));
    if (writeResult) {
      pass(`memory_write 成功: ${writeResult}`);
    } else {
      fail('memory_write', `tool results: ${r1.toolResults.join('; ') || '无'}, error: ${r1.error || '无'}`);
    }

    // 3. memory_read
    log('3/5', 'memory_read — 读取记忆...');
    const s2 = `mem-read-${Date.now()}`;
    const r2 = await directChat(directUrl, token, s2,
      '请使用 memory_read 工具读取名为 "e2e-test-decision" 的记忆。只调用工具不要多说。');

    const readResult = r2.toolResults.find(r => r.includes('e2e-test-decision') || r.includes('gemini'));
    if (readResult) {
      pass(`memory_read 成功: ${readResult.slice(0, 100)}`);
    } else {
      fail('memory_read', `tool results: ${r2.toolResults.join('; ').slice(0, 200) || '无'}`);
    }

    // 4. memory_search
    log('4/5', 'memory_search — 搜索记忆...');
    const s3 = `mem-search-${Date.now()}`;
    const r3 = await directChat(directUrl, token, s3,
      '请使用 memory_search 工具搜索关键词 "gemini"。只调用工具不要多说。');

    const searchResult = r3.toolResults.find(r => r.includes('gemini') || r.includes('e2e-test'));
    if (searchResult) {
      pass(`memory_search 成功: ${searchResult.slice(0, 100)}`);
    } else if (r3.toolResults.find(r => r.includes('No memories'))) {
      fail('memory_search', '搜索无结果（记忆可能未持久化到 FTS）');
    } else {
      fail('memory_search', `tool results: ${r3.toolResults.join('; ').slice(0, 200) || '无'}`);
    }

    // 5. 跨 session 持久化验证
    log('5/5', '跨 session 持久化...');
    const s4 = `mem-cross-${Date.now()}`;
    const r4 = await directChat(directUrl, token, s4,
      '请使用 memory_read 工具（不传 name 参数）获取记忆索引列表。只调用工具不要多说。');

    const indexResult = r4.toolResults.find(r => r.includes('decision') || r.includes('e2e-test'));
    if (indexResult) {
      pass(`跨 session 持久化: 新 session 能读到之前写入的记忆`);
      console.log(`    索引: ${indexResult.slice(0, 200)}`);
    } else {
      fail('跨 session', `索引中未找到记忆: ${r4.toolResults.join('; ').slice(0, 200) || '无'}`);
    }

    console.log('\n' + green('=== Memory 验证完成 ===') + '\n');

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
