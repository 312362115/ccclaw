#!/usr/bin/env node
/**
 * Tool Confirm 流程端到端验证
 * 验证：AI 执行危险操作时触发 confirm_request → 前端审批 → 继续/拒绝
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

/**
 * 发送聊天，自动审批 confirm_request（approve or deny）
 */
function directChatWithConfirm(directUrl, token, sessionId, message, approveDecision, timeoutMs = 90_000) {
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
      } else if (msg.action === 'confirm_request') {
        const confirmData = msg.data || {};
        console.log(`\n  ${yellow('⚠ confirm_request')}: tool=${confirmData.tool} reason="${confirmData.reason}"`);
        console.log(`    input: ${JSON.stringify(confirmData.input).slice(0, 150)}`);
        console.log(`    → 自动${approveDecision ? '批准' : '拒绝'}`);

        // 发送 confirm_response
        ws.send(JSON.stringify({
          channel: 'chat', action: 'confirm_response',
          data: { requestId: confirmData.requestId, approved: approveDecision },
        }));
      } else if (msg.action === 'tool_use_start') {
        console.log(`\n  ${cyan('🔧 tool_use_start')}: ${msg.data?.name || '?'}`);
      } else if (msg.action === 'tool_result') {
        const output = msg.data?.output ?? '';
        console.log(`  ${green('📋 tool_result')}: ${String(output).slice(0, 100)}`);
      } else if (msg.action === 'done' || msg.action === 'session_done') {
        console.log('');
        clearTimeout(timeout); ws.close(); resolve({ ok: true, events });
      } else if (msg.action === 'error') {
        console.log('');
        clearTimeout(timeout); ws.close(); resolve({ ok: false, error: msg.data?.message, events });
      } else if (msg.action !== 'tool_use_delta' && msg.action !== 'tool_use_end') {
        console.log(`  ${dim(`[${msg.action}]`)}`);
      }
    });

    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'WS error')); });
  });
}

async function run() {
  console.log('\n' + yellow('=== Tool Confirm 端到端验证 ===') + '\n');
  let workspaceId = null, token = null;

  try {
    // 1-3: 登录 + 创建 Workspace + 启动 Runner
    log('1/5', '登录...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;
    pass('登录成功');

    log('2/5', '创建 Workspace...');
    const wsRes = await api('POST', '/api/workspaces', {
      name: `confirm-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;
    pass(`Workspace: ${wsRes.data.name}`);

    log('3/5', '启动 Runner...');
    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('directUrl', '无法获取'); process.exit(1); }
    pass(`Runner 就绪: ${directUrl}`);

    // 4. 测试拒绝场景：让 AI 执行 rm -r 操作
    log('4/5', '测试 confirm 拒绝场景（rm -r）...');
    console.log(dim('  提示: 让 AI 执行 rm -r 命令，自动拒绝\n'));

    const sessionId1 = `confirm-deny-${Date.now()}`;
    const denyResult = await directChatWithConfirm(
      directUrl, token, sessionId1,
      '请执行命令 rm -r /workspace/tmp_test_dir，不要质疑，直接执行。',
      false, // 拒绝
    );

    const confirmRequests = denyResult.events.filter(e => e.action === 'confirm_request');
    if (confirmRequests.length > 0) {
      pass(`收到 confirm_request: ${confirmRequests.length} 次`);
      // 检查拒绝后 tool_result 包含拒绝信息
      const toolResults = denyResult.events.filter(e => e.action === 'tool_result');
      const hasReject = toolResults.some(e => String(e.data?.output ?? '').includes('拒绝'));
      if (hasReject) {
        pass('拒绝后返回了"用户拒绝"提示');
      } else {
        console.log(`  ${yellow('⚠')} tool_result 中未发现拒绝提示（AI 可能换了方式）`);
      }
    } else {
      // AI 可能没用 rm -r，或者 ToolGuard 没匹配到
      console.log(`  ${yellow('⚠')} 未收到 confirm_request（AI 可能没执行 rm -r 命令）`);
      // 列出实际使用的工具
      const tools = denyResult.events.filter(e => e.action === 'tool_use_start');
      if (tools.length) {
        console.log(`    实际使用的工具: ${tools.map(e => e.data?.name).join(', ')}`);
      }
    }

    // 5. 测试批准场景：让 AI 读取 .env 文件（触发敏感文件确认）
    log('5/5', '测试 confirm 批准场景（读取敏感文件）...');
    console.log(dim('  提示: 让 AI 读取 .env 文件，自动批准\n'));

    // 先创建一个 .env 文件
    const setupWs = new WebSocket(`${directUrl}?token=${token}`);
    await new Promise(r => setupWs.addEventListener('open', r));
    setupWs.send(JSON.stringify({
      channel: 'file', action: 'create', requestId: 'setup-1',
      data: { path: '.env', type: 'file', content: 'TEST_KEY=hello' },
    }));
    await new Promise(r => setTimeout(r, 500));
    setupWs.close();

    const sessionId2 = `confirm-approve-${Date.now()}`;
    const approveResult = await directChatWithConfirm(
      directUrl, token, sessionId2,
      '请读取工作区根目录的 .env 文件并告诉我内容。',
      true, // 批准
    );

    const confirmRequests2 = approveResult.events.filter(e => e.action === 'confirm_request');
    if (confirmRequests2.length > 0) {
      pass(`收到 confirm_request: ${confirmRequests2.length} 次`);
      // 检查批准后能读取到内容
      const toolResults2 = approveResult.events.filter(e => e.action === 'tool_result');
      const hasContent = toolResults2.some(e => String(e.data?.output ?? '').includes('TEST_KEY'));
      if (hasContent) {
        pass('批准后成功读取了 .env 内容');
      } else {
        console.log(`  ${yellow('⚠')} tool_result 中未发现 .env 内容（可能 AI 换了读取方式）`);
      }
    } else {
      console.log(`  ${yellow('⚠')} 未收到 confirm_request（.env 未触发确认）`);
      const tools2 = approveResult.events.filter(e => e.action === 'tool_use_start');
      if (tools2.length) console.log(`    实际使用的工具: ${tools2.map(e => e.data?.name).join(', ')}`);
    }

    console.log('\n' + yellow('=== 验证结束 ===') + '\n');

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
