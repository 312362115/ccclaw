#!/usr/bin/env node
/**
 * 端到端验证脚本
 * 验证完整链路：登录 → 创建 Workspace → WebSocket 连接 → 发消息 → 收到 AI 回复
 */

// 使用 Node.js 原生 WebSocket（Node 22+）

const BASE = 'http://127.0.0.1:3000';
const WS_URL = 'ws://127.0.0.1:3000/ws';

const ADMIN_EMAIL = 'admin@ccclaw.test';
const ADMIN_PASSWORD = 'test1234pass';

// 颜色输出
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function log(step, msg) {
  console.log(`${cyan(`[${step}]`)} ${msg}`);
}

function pass(step) {
  console.log(`${green('✓')} ${step}`);
}

function fail(step, err) {
  console.log(`${red('✗')} ${step}: ${err}`);
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log('\n' + yellow('=== CCCLaw 端到端验证 ===') + '\n');

  // Step 1: 登录
  log('1/6', '登录...');
  const loginRes = await api('POST', '/api/auth/login', {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  if (loginRes.status !== 200 || !loginRes.data.accessToken) {
    fail('登录', JSON.stringify(loginRes.data));
    process.exit(1);
  }
  const token = loginRes.data.accessToken;
  pass('登录成功');

  // Step 2: 确认 Provider 存在
  log('2/6', '检查 Provider...');
  const provRes = await api('GET', '/api/providers', null, token);
  if (provRes.status !== 200 || !provRes.data.length) {
    fail('Provider', '无可用 Provider');
    process.exit(1);
  }
  const defaultProvider = provRes.data.find((p) => p.isDefault);
  pass(`Provider 就绪: ${defaultProvider?.name || provRes.data[0].name} (${defaultProvider?.type || provRes.data[0].type})`);

  // Step 3: 创建 Workspace
  log('3/6', '创建测试 Workspace...');
  const wsName = `e2e-test-${Date.now()}`;
  const wsRes = await api('POST', '/api/workspaces', {
    name: wsName,
    settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
  }, token);
  if (wsRes.status !== 201 && wsRes.status !== 200) {
    fail('创建 Workspace', JSON.stringify(wsRes.data));
    process.exit(1);
  }
  const workspace = wsRes.data;
  pass(`Workspace 创建成功: ${workspace.name} (${workspace.id})`);

  // Step 4: WebSocket 连接 + 认证
  log('4/6', 'WebSocket 连接...');
  const ws = new WebSocket(WS_URL);

  const messages = [];
  let authOk = false;

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: '超时（60s）未收到 AI 回复' });
      ws.close();
    }, 60_000);

    ws.addEventListener('open', () => {
      // 发送认证
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'auth_ok') {
        authOk = true;
        pass('WebSocket 认证成功');

        // Step 5: 发送聊天消息
        log('5/6', '发送聊天消息...');
        const sessionId = `e2e-session-${Date.now()}`;
        ws.send(JSON.stringify({
          type: 'message',
          workspaceId: workspace.id,
          sessionId,
          content: '你好，请用一句话介绍你自己。',
        }));
        log('5/6', `消息已发送，等待 AI 回复 (workspaceId=${workspace.id}, sessionId=${sessionId})...`);
      } else if (msg.type === 'error') {
        console.log(`  ${red('error')}: ${msg.message}`);
        messages.push(msg);
        clearTimeout(timeout);
        resolve({ ok: false, error: msg.message, messages });
        ws.close();
      } else if (msg.type === 'text_delta') {
        process.stdout.write(msg.content || '');
        messages.push(msg);
      } else if (msg.type === 'done') {
        console.log(''); // 换行
        messages.push(msg);
        clearTimeout(timeout);
        resolve({ ok: true, messages, tokens: msg.tokens });
        ws.close();
      } else {
        // 其他消息类型也记录
        console.log(`  ${yellow(msg.type)}: ${JSON.stringify(msg).slice(0, 200)}`);
        messages.push(msg);
      }
    });

    ws.addEventListener('error', (event) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: event.message || 'WebSocket error' });
    });

    ws.addEventListener('close', (event) => {
      if (!messages.length) {
        clearTimeout(timeout);
        resolve({ ok: false, error: `WebSocket 关闭: code=${event.code} reason=${event.reason}` });
      }
    });
  });

  // Step 6: 验证结果
  log('6/6', '验证结果...');
  if (result.ok) {
    const fullText = result.messages
      .filter((m) => m.type === 'text_delta')
      .map((m) => m.content || '')
      .join('');
    pass(`端到端验证通过！`);
    console.log(`  AI 回复: ${fullText.slice(0, 200)}${fullText.length > 200 ? '...' : ''}`);
    console.log(`  Token 消耗: ${result.tokens}`);
    console.log(`  消息数量: ${result.messages.length}`);
  } else {
    fail('端到端验证失败', result.error);
    if (result.messages?.length) {
      console.log(`  收到 ${result.messages.length} 条消息:`);
      for (const m of result.messages.slice(0, 5)) {
        console.log(`    ${m.type}: ${JSON.stringify(m).slice(0, 150)}`);
      }
    }
  }

  // 清理：删除测试 Workspace
  log('清理', '删除测试 Workspace...');
  await api('DELETE', `/api/workspaces/${workspace.id}`, null, token);
  pass('清理完成');

  console.log('\n' + yellow('=== 验证结束 ===') + '\n');
  process.exit(result.ok ? 0 : 1);
}

run().catch((err) => {
  console.error(red('脚本异常:'), err);
  process.exit(1);
});
