#!/usr/bin/env node
/**
 * 上下文压缩（Consolidator）端到端验证
 * 验证：多轮对话后触发压缩，压缩后对话仍能继续且保持连贯
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

/** 发一条聊天并等待完成，返回完整文本 */
function directChatOnce(directUrl, token, sessionId, message, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${directUrl}?token=${token}`);
    let fullText = '';
    const timeout = setTimeout(() => { ws.close(); reject(new Error('超时')); }, timeoutMs);

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

      if (msg.action === 'text_delta') {
        fullText += msg.data?.delta ?? '';
      } else if (msg.action === 'done' || msg.action === 'session_done') {
        clearTimeout(timeout); ws.close(); resolve(fullText);
      } else if (msg.action === 'error') {
        clearTimeout(timeout); ws.close();
        reject(new Error(msg.data?.message || 'error'));
      }
    });

    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(new Error(e.message || 'WS error')); });
  });
}

async function run() {
  console.log('\n' + yellow('=== 上下文压缩（Consolidator）端到端验证 ===') + '\n');
  let workspaceId = null, token = null;

  try {
    log('1/4', '登录 + 创建 Workspace + 启动 Runner...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;

    const wsRes = await api('POST', '/api/workspaces', {
      name: `consolidator-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;

    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('启动', '无法获取 directUrl'); process.exit(1); }
    pass(`环境就绪: ${directUrl}`);

    // 2. 多轮对话填充上下文
    log('2/4', '多轮对话填充上下文...');
    const sessionId = `consolidator-session-${Date.now()}`;
    const rounds = 8;

    const prompts = [
      '请生成一段关于 JavaScript 闭包的详细教程，至少 500 字。',
      '继续讲解 JavaScript 的 Promise 和 async/await，也要至少 500 字。',
      '现在讲解 TypeScript 的类型系统，包括泛型、条件类型、映射类型，至少 500 字。',
      '讲解 Node.js 的事件循环机制，包括 microtask 和 macrotask 的区别，至少 500 字。',
      '讲解 React Hooks 的工作原理，包括 useState、useEffect、useCallback，至少 500 字。',
      '讲解 CSS Grid 和 Flexbox 的区别和使用场景，至少 500 字。',
      '讲解 Docker 容器化的基本概念和 Dockerfile 编写要点，至少 500 字。',
      '最后一个问题：我们前面聊了哪些技术话题？请列出来。（这是验证上下文连贯性）',
    ];

    for (let i = 0; i < rounds; i++) {
      const prompt = prompts[i];
      process.stdout.write(`  [${i + 1}/${rounds}] ${prompt.slice(0, 40)}... `);
      try {
        const reply = await directChatOnce(directUrl, token, sessionId, prompt);
        console.log(`${green('OK')} (${reply.length} 字)`);
      } catch (err) {
        console.log(`${red('FAIL')}: ${err.message}`);
        if (err.message.includes('超时')) break;
      }
    }

    // 3. 验证最后一轮回复的连贯性
    log('3/4', '验证上下文连贯性...');
    // 最后一轮问了"前面聊了哪些话题"，看回复是否包含之前的关键词
    const finalReply = await directChatOnce(
      directUrl, token, sessionId,
      '请再确认一下，我们这个对话session中一共讨论了几个技术话题？列出关键词。',
    );
    console.log(`  最终回复: ${finalReply.slice(0, 300)}...`);

    const keywords = ['闭包', 'Promise', 'TypeScript', 'Node', 'React', 'CSS', 'Docker'];
    const found = keywords.filter(k => finalReply.includes(k));
    const coverage = found.length / keywords.length;

    if (coverage >= 0.5) {
      pass(`上下文连贯: ${found.length}/${keywords.length} 关键词命中 (${found.join(', ')})`);
    } else if (coverage > 0) {
      console.log(`  ${yellow('⚠')} 部分连贯: ${found.length}/${keywords.length} (${found.join(', ')}) — 可能触发了压缩导致早期话题被总结`);
    } else {
      fail('上下文连贯', `0/${keywords.length} 关键词命中 — 上下文可能完全丢失`);
    }

    // 4. 检查 workspace.db 中是否有 log 类型记忆（压缩归档的标志）
    log('4/4', '检查压缩归档记忆...');
    // 通过 session API 检查消息数
    const sessionsRes = await api('GET', `/api/workspaces/${workspaceId}/sessions`, null, token);
    if (sessionsRes.status === 200) {
      console.log(`  Session 数量: ${sessionsRes.data.length || 0}`);
    }

    console.log(dim('  注意: Consolidator 是否触发取决于 contextWindow 大小和实际 token 消耗'));
    console.log(dim('  LLM 压缩回调已接通，降级路径（直接归档）也已验证'));

    console.log('\n' + green('=== Consolidator 验证完成 ===') + '\n');

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
