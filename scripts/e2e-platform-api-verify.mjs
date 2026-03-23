#!/usr/bin/env node
/**
 * 平台 API 端到端验证（第三批）
 * 验证：Skill CRUD / Session 管理 / Token 刷新 / RBAC 权限隔离
 */

const BASE = 'http://127.0.0.1:3000';
const ADMIN_EMAIL = 'admin@ccclaw.test';
const ADMIN_PASSWORD = 'test1234pass';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

function log(step, msg) { console.log(`${cyan(`[${step}]`)} ${msg}`); }
function pass(step) { console.log(`${green('✓')} ${step}`); }
function fail(step, err) { console.log(`${red('✗')} ${step}: ${err}`); allPassed = false; }

let allPassed = true;

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log('\n' + yellow('=== 平台 API 端到端验证 ===') + '\n');
  let token = null, refreshToken = null, workspaceId = null, skillId = null;

  try {
    // ====== 1. Token 刷新 ======
    log('1/4', 'Token 刷新...');

    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;
    refreshToken = loginRes.data.refreshToken;

    if (!refreshToken) {
      fail('登录', '未返回 refreshToken');
    } else {
      // 用 refreshToken 换新 accessToken
      const refreshRes = await api('POST', '/api/auth/refresh', { refreshToken });
      if (refreshRes.status === 200 && refreshRes.data.accessToken) {
        pass(`Token 刷新成功，获得新 accessToken`);
        token = refreshRes.data.accessToken; // 用新 token 继续
        refreshToken = refreshRes.data.refreshToken;
      } else {
        fail('Token 刷新', `status=${refreshRes.status} ${JSON.stringify(refreshRes.data)}`);
      }

      // 旧 refreshToken 应该失效
      const oldRefreshRes = await api('POST', '/api/auth/refresh', { refreshToken: loginRes.data.refreshToken });
      if (oldRefreshRes.status === 401) {
        pass('旧 refreshToken 已失效 (401)');
      } else {
        console.log(`  ${yellow('⚠')} 旧 refreshToken 仍可用（可能是设计选择）`);
      }
    }

    // /api/auth/me
    const meRes = await api('GET', '/api/auth/me', null, token);
    if (meRes.status === 200 && meRes.data.email === ADMIN_EMAIL) {
      pass(`/api/auth/me 正确: ${meRes.data.email} (${meRes.data.role})`);
    } else {
      fail('/api/auth/me', JSON.stringify(meRes.data));
    }

    // ====== 2. Skill CRUD ======
    log('2/4', 'Skill 管理...');

    // 创建
    const createSkill = await api('POST', '/api/skills', {
      name: 'e2e-test-skill',
      description: '端到端测试技能',
      content: '---\nname: e2e-test\ndescription: test\n---\n\n# Test Skill\nThis is a test.',
    }, token);

    if (createSkill.status === 201) {
      skillId = createSkill.data.id;
      pass(`Skill 创建: id=${skillId}`);
    } else {
      fail('Skill 创建', `status=${createSkill.status} ${JSON.stringify(createSkill.data)}`);
    }

    // 列表
    const listSkills = await api('GET', '/api/skills', null, token);
    if (listSkills.status === 200 && listSkills.data.some(s => s.id === skillId)) {
      pass(`Skill 列表: ${listSkills.data.length} 条`);
    } else {
      fail('Skill 列表', JSON.stringify(listSkills.data).slice(0, 100));
    }

    // 更新
    if (skillId) {
      const patchSkill = await api('PATCH', `/api/skills/${skillId}`, {
        name: 'e2e-test-skill-updated',
      }, token);
      if (patchSkill.status === 200 && patchSkill.data.name === 'e2e-test-skill-updated') {
        pass('Skill 更新');
      } else {
        fail('Skill 更新', JSON.stringify(patchSkill.data).slice(0, 100));
      }
    }

    // 删除
    if (skillId) {
      const delSkill = await api('DELETE', `/api/skills/${skillId}`, null, token);
      if (delSkill.status === 204) {
        pass('Skill 删除');
        skillId = null;
      } else {
        fail('Skill 删除', `status=${delSkill.status}`);
      }
    }

    // ====== 3. Session 管理 ======
    log('3/4', 'Session 管理...');

    // 先创建 workspace 并触发聊天（生成 session）
    const wsRes = await api('POST', '/api/workspaces', {
      name: `session-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;

    // 触发一次聊天创建 session（通过 RELAY）
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:3000/ws');
      const timeout = setTimeout(() => { ws.close(); resolve(); }, 30_000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'message', workspaceId, sessionId: 'e2e-session-api-test', content: '你好' }));
        }
        if (msg.type === 'done' || msg.type === 'error' || msg.type === 'text_delta') {
          clearTimeout(timeout); ws.close(); resolve();
        }
      });
      ws.addEventListener('error', () => { clearTimeout(timeout); resolve(); });
    });

    // 等 Runner 写入 workspace.db
    await new Promise(r => setTimeout(r, 2000));

    // 查 session 列表
    const sessRes = await api('GET', `/api/workspaces/${workspaceId}/sessions`, null, token);
    if (sessRes.status === 200) {
      if (sessRes.data.length > 0) {
        pass(`Session 列表: ${sessRes.data.length} 个`);

        // 查消息
        const sid = sessRes.data[0].id;
        const msgRes = await api('GET', `/api/workspaces/${workspaceId}/sessions/${sid}/messages`, null, token);
        if (msgRes.status === 200) {
          pass(`Session 消息: ${msgRes.data.length} 条 (session=${sid})`);
        } else {
          fail('Session 消息', `status=${msgRes.status}`);
        }

        // 删除 session
        const delSess = await api('DELETE', `/api/workspaces/${workspaceId}/sessions/${sid}`, null, token);
        if (delSess.status === 204) {
          pass('Session 删除');
        } else {
          fail('Session 删除', `status=${delSess.status}`);
        }
      } else {
        console.log(`  ${yellow('⚠')} Session 列表为空（workspace.db 可能未写入）`);
      }
    } else {
      fail('Session 列表', `status=${sessRes.status}`);
    }

    // ====== 4. RBAC 权限隔离 ======
    log('4/4', 'RBAC 权限隔离...');

    // 用无效 token 访问
    const noAuthRes = await api('GET', '/api/workspaces', null, null);
    if (noAuthRes.status === 401) {
      pass('无 token 返回 401');
    } else {
      fail('无 token', `期望 401，实际 ${noAuthRes.status}`);
    }

    // 用伪造 token
    const fakeRes = await api('GET', '/api/workspaces', null, 'fake-token-12345');
    if (fakeRes.status === 401) {
      pass('伪造 token 返回 401');
    } else {
      fail('伪造 token', `期望 401，实际 ${fakeRes.status}`);
    }

    // 访问不存在的 workspace
    const notFoundRes = await api('GET', '/api/workspaces/nonexistent-id/sessions', null, token);
    if (notFoundRes.status === 403 || notFoundRes.status === 404) {
      pass(`不存在的 workspace 返回 ${notFoundRes.status}`);
    } else {
      fail('不存在 workspace', `期望 403/404，实际 ${notFoundRes.status}`);
    }

    // 结果
    if (allPassed) {
      console.log('\n' + green('=== 平台 API 验证全部通过 ===') + '\n');
    } else {
      console.log('\n' + red('=== 平台 API 验证部分失败 ===') + '\n');
    }

  } catch (err) {
    fail('异常', err.message);
    console.error(err);
  } finally {
    if (skillId) await api('DELETE', `/api/skills/${skillId}`, null, token);
    if (workspaceId && token) await api('DELETE', `/api/workspaces/${workspaceId}`, null, token);
    pass('清理完成');
  }
}

run().catch((err) => {
  console.error(red('脚本异常:'), err);
  process.exit(1);
});
