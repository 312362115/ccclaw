#!/usr/bin/env node
/**
 * Docker Runner AI 对话端到端验证
 * 验证：创建 docker 工作区 → 配置 Provider → ensure-config → WebSocket 直连 → 发消息 → 收到 AI 回复
 */
// Node 22+ 内置 WebSocket（基于 undici），不需要 ws 包

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const ADMIN_EMAIL = 'admin@ccclaw.test';
const ADMIN_PASSWORD = 'test1234pass';

// LLM 配置
const LLM_BASE_URL = 'http://127.0.0.1:8317';
const LLM_API_KEY = 'your-api-key-1';
const LLM_MODEL = 'qwen3-coder-plus';

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function main() {
  let token, wsId, wsSlug, providerId, cid;

  try {
    // 1. 登录
    console.log('=== 1. 登录 ===');
    const login = await api('POST', '/api/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (login.status !== 200) throw new Error(`登录失败: ${JSON.stringify(login.data)}`);
    token = login.data.accessToken;
    console.log(`  OK: token=${token.slice(0, 20)}...`);

    // 2. 创建 Provider（litellm 类型）
    console.log('\n=== 2. 创建 Provider ===');
    const provRes = await api('POST', '/api/providers', token, {
      name: 'docker-e2e-qwen3',
      type: 'litellm',
      authType: 'api_key',
      config: { key: LLM_API_KEY, baseURL: LLM_BASE_URL },
      isDefault: false,
    });
    if (provRes.status !== 201) throw new Error(`Provider 创建失败: ${JSON.stringify(provRes.data)}`);
    providerId = provRes.data.id;
    console.log(`  OK: providerId=${providerId}`);

    // 3. 创建 Docker 工作区（绑定 Provider + Model）
    console.log('\n=== 3. 创建 Docker 工作区 ===');
    const wsRes = await api('POST', '/api/workspaces', token, {
      name: 'docker-chat-e2e',
      settings: { startMode: 'docker', providerId, model: LLM_MODEL },
    });
    if (wsRes.status !== 201) throw new Error(`工作区创建失败: ${JSON.stringify(wsRes.data)}`);
    wsId = wsRes.data.id;
    wsSlug = wsRes.data.slug;
    console.log(`  OK: id=${wsId} slug=${wsSlug}`);

    // 4. ensure-config（启动容器 + 推配置）
    console.log('\n=== 4. ensure-config ===');
    const ensure = await api('POST', `/api/workspaces/${wsId}/ensure-config`, token);
    if (ensure.status !== 200) throw new Error(`ensure-config 失败: ${JSON.stringify(ensure.data)}`);
    console.log(`  OK: ${JSON.stringify(ensure.data)}`);

    // 等容器稳定
    await sleep(2000);

    // 5. 获取 runner-info（直连 URL）
    console.log('\n=== 5. 获取 runner-info ===');
    const infoRes = await api('GET', `/api/workspaces/${wsId}/runner-info`, token);
    if (infoRes.status !== 200) throw new Error(`runner-info 失败: ${JSON.stringify(infoRes.data)}`);
    // directUrl 是 ws://host.docker.internal:PORT，从宿主机访问要换成 127.0.0.1
    let directUrl = infoRes.data.directUrl.replace('host.docker.internal', '127.0.0.1');
    console.log(`  directUrl: ${directUrl}`);

    // 6. WebSocket 直连 Runner 发消息
    console.log('\n=== 6. WebSocket 直连发送消息 ===');
    const sessionId = `e2e-session-${Date.now()}`;
    const requestId = `req-${Date.now()}`;
    const reply = await sendChatMessage(directUrl, token, sessionId, requestId, '你好，请用一句话介绍你自己');
    console.log(`  AI 回复: ${reply.slice(0, 100)}${reply.length > 100 ? '...' : ''}`);

    if (reply.length > 0) {
      console.log('\n  PASS: AI 对话端到端验证成功');
    } else {
      console.log('\n  FAIL: 未收到 AI 回复');
      process.exitCode = 1;
    }

    // 7. 查看容器
    cid = execSync(`docker ps -q --filter "label=ccclaw.workspace.slug=${wsSlug}" | head -1`).toString().trim();
    if (cid) {
      console.log(`\n=== 7. Runner 日志（最后 5 行） ===`);
      console.log(execSync(`docker logs ${cid} 2>&1 | tail -5`).toString());
    }

  } finally {
    // 清理
    console.log('\n=== 清理 ===');
    if (cid) {
      try { execSync(`docker stop ${cid}`, { stdio: 'pipe' }); console.log('  容器已停止'); } catch {}
    } else if (wsSlug) {
      try {
        const c = execSync(`docker ps -q --filter "label=ccclaw.workspace.slug=${wsSlug}" | head -1`).toString().trim();
        if (c) { execSync(`docker stop ${c}`, { stdio: 'pipe' }); console.log('  容器已停止'); }
      } catch {}
    }
    if (wsId) {
      await api('DELETE', `/api/workspaces/${wsId}`, token);
      console.log('  工作区已删除');
    }
    if (providerId) {
      await api('DELETE', `/api/providers/${providerId}`, token);
      console.log('  Provider 已删除');
    }
  }
}

function sendChatMessage(wsUrl, token, sessionId, requestId, message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?token=${token}`);
    let textParts = [];
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; ws.close(); resolve(textParts.join('')); }
    }, 30000);

    ws.onopen = () => {
      console.log('  WebSocket 已连接');
      ws.send(JSON.stringify({
        channel: 'chat',
        action: 'message',
        requestId,
        data: { sessionId, message },
      }));
      console.log(`  已发送: "${message}"`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (msg.channel === 'chat') {
          if (msg.action === 'text_delta' && msg.data?.delta) {
            textParts.push(msg.data.delta);
          } else if (msg.action === 'done' || msg.action === 'error') {
            if (msg.action === 'error') {
              console.log(`  Error: ${JSON.stringify(msg.data)}`);
            }
            done = true;
            clearTimeout(timeout);
            ws.close();
            resolve(textParts.join(''));
          }
        }
      } catch {}
    };

    ws.onerror = (err) => {
      if (!done) { done = true; clearTimeout(timeout); reject(err); }
    };

    ws.onclose = () => {
      if (!done) { done = true; clearTimeout(timeout); resolve(textParts.join('')); }
    };
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// execSync import
import { execSync } from 'child_process';

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
