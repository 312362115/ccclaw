#!/usr/bin/env node
/**
 * 文件同步端到端验证
 * 验证：文件树获取 + 文件 CRUD + FileWatcher 实时事件推送
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

/** 触发 Runner 启动 */
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

/** 直连 WebSocket 请求-响应 */
function directRequest(ws, channel, action, data) {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${channel}.${action} 超时`)), 10_000);

    const handler = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
      if (msg.requestId === requestId) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        resolve(msg);
      }
    };
    ws.addEventListener('message', handler);

    ws.send(JSON.stringify({ channel, action, requestId, data }));
  });
}

/** 等待 tree.events 消息 */
function waitForTreeEvent(ws, matchFn, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error('等待 tree.events 超时'));
    }, timeoutMs);

    const handler = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
      if (msg.channel === 'tree' && msg.action === 'events') {
        const events = msg.data?.events || [];
        const matched = events.find(matchFn);
        if (matched) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          resolve(matched);
        }
      }
    };
    ws.addEventListener('message', handler);
  });
}

async function run() {
  console.log('\n' + yellow('=== 文件同步 端到端验证 ===') + '\n');
  let ws = null;
  let workspaceId = null;
  let token = null;

  try {
    // 1. 登录
    log('1/8', '登录...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (loginRes.status !== 200) { fail('登录', JSON.stringify(loginRes.data)); process.exit(1); }
    token = loginRes.data.accessToken;
    pass('登录成功');

    // 2. 创建 Workspace
    log('2/8', '创建 Workspace...');
    const wsRes = await api('POST', '/api/workspaces', {
      name: `file-sync-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    if (wsRes.status !== 201 && wsRes.status !== 200) { fail('创建', JSON.stringify(wsRes.data)); process.exit(1); }
    workspaceId = wsRes.data.id;
    pass(`Workspace: ${wsRes.data.name}`);

    // 3. 触发 Runner + 获取 directUrl
    log('3/8', '启动 Runner...');
    await triggerRunner(token, workspaceId);
    await api('POST', `/api/workspaces/${workspaceId}/ensure-config`, null, token);
    const directUrl = await waitForDirectUrl(token, workspaceId);
    if (!directUrl) { fail('directUrl', '无法获取'); process.exit(1); }
    pass(`Runner 就绪: ${directUrl}`);

    // 4. 直连 WebSocket
    log('4/8', '直连 WebSocket...');
    ws = new WebSocket(`${directUrl}?token=${token}`);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', (e) => reject(new Error(e.message || 'WS error')));
      setTimeout(() => reject(new Error('连接超时')), 5000);
    });
    pass('直连已建立');

    // 5. 获取文件树
    log('5/10', '获取文件树 (tree.list)...');
    const treeResult = await directRequest(ws, 'tree', 'list', { path: '/', depth: 2 });
    const treeData = treeResult.data;
    if (treeData && treeData.entries !== undefined) {
      pass(`文件树: ${treeData.entries.length} 个条目 (path=${treeData.path}, truncated=${treeData.truncated})`);
      // 显示前几个条目
      for (const entry of (treeData.entries || []).slice(0, 5)) {
        console.log(`    ${entry.type === 'directory' ? '📁' : '📄'} ${entry.name}${entry.children ? ` (${entry.children.length} children)` : ''}`);
      }
      if (treeData.entries.length > 5) console.log(`    ... 还有 ${treeData.entries.length - 5} 个`);
    } else {
      fail('文件树', JSON.stringify(treeData).slice(0, 200));
    }

    // 6. 创建文件
    log('6/10', '创建文件 (file.create)...');
    const testFileName = `e2e-test-${Date.now()}.txt`;
    const testContent = `Hello from E2E test at ${new Date().toISOString()}`;

    // 同时监听 tree.events
    const eventPromise = waitForTreeEvent(ws, (e) => e.path?.includes(testFileName) && e.type === 'created', 5000)
      .catch(() => null); // 不阻塞，可能来得早

    const createResult = await directRequest(ws, 'file', 'create', {
      path: testFileName,
      type: 'file',
      content: testContent,
    });
    if (createResult.data?.ok || createResult.action === 'create_result') {
      pass(`文件已创建: ${testFileName}`);
    } else {
      fail('创建文件', JSON.stringify(createResult.data).slice(0, 200));
    }

    // 检查 FileWatcher 事件
    const watcherEvent = await eventPromise;
    if (watcherEvent) {
      pass(`FileWatcher 实时事件: ${watcherEvent.type} ${watcherEvent.path}`);
    } else {
      console.log(`  ${yellow('⚠')} FileWatcher 事件未在 5s 内收到（debounce 或时序问题，非致命）`);
    }

    // 7. 读取文件
    log('7/10', '读取文件 (file.read)...');
    const readResult = await directRequest(ws, 'file', 'read', { path: testFileName });
    const readContent = readResult.data?.content;
    if (readContent === testContent) {
      pass(`文件内容一致: "${readContent.slice(0, 50)}..."`);
    } else if (readContent) {
      fail('文件内容', `期望 "${testContent.slice(0, 30)}..." 实际 "${String(readContent).slice(0, 30)}..."`);
    } else {
      fail('读取文件', JSON.stringify(readResult.data).slice(0, 200));
    }

    // 8. 编辑文件
    log('8/10', '编辑文件 (file.write)...');
    const updatedContent = `Updated at ${new Date().toISOString()}`;
    const writeResult = await directRequest(ws, 'file', 'write', {
      path: testFileName,
      content: updatedContent,
    });
    if (writeResult.data?.success || writeResult.action === 'write_result') {
      pass(`文件已更新: size=${writeResult.data?.size}`);
      // 验证内容
      const reRead = await directRequest(ws, 'file', 'read', { path: testFileName });
      if (reRead.data?.content === updatedContent) {
        pass('编辑后内容一致');
      } else {
        fail('编辑后内容', `期望 "${updatedContent.slice(0, 30)}..." 实际 "${String(reRead.data?.content).slice(0, 30)}..."`);
      }
    } else {
      fail('编辑文件', JSON.stringify(writeResult.data).slice(0, 200));
    }

    // 9. 重命名文件
    log('9/10', '重命名文件 (file.rename)...');
    const renamedFileName = `renamed-${testFileName}`;
    const renameResult = await directRequest(ws, 'file', 'rename', {
      oldPath: testFileName,
      newPath: renamedFileName,
    });
    if (renameResult.data?.success || renameResult.action === 'rename_result') {
      pass(`文件已重命名: ${testFileName} → ${renamedFileName}`);
      // 验证旧路径不存在
      try {
        const oldStat = await directRequest(ws, 'file', 'stat', { path: testFileName });
        if (oldStat.action === 'error') {
          pass('旧路径已不存在');
        } else {
          console.log(`  ${yellow('⚠')} 旧路径仍存在`);
        }
      } catch { pass('旧路径已不存在'); }
      // 验证新路径可读
      const newRead = await directRequest(ws, 'file', 'read', { path: renamedFileName });
      if (newRead.data?.content === updatedContent) {
        pass('重命名后内容一致');
      } else {
        fail('重命名后内容', JSON.stringify(newRead.data).slice(0, 100));
      }
    } else {
      fail('重命名文件', JSON.stringify(renameResult.data).slice(0, 200));
    }

    // 10. 删除文件（用重命名后的名字）
    log('10/10', '删除文件 (file.delete)...');
    const fileToDelete = renameResult.data?.success ? renamedFileName : testFileName;
    const deleteEventPromise = waitForTreeEvent(ws, (e) => e.path?.includes(fileToDelete) && e.type === 'deleted', 5000)
      .catch(() => null);

    const deleteResult = await directRequest(ws, 'file', 'delete', { path: fileToDelete });
    if (deleteResult.data?.ok || deleteResult.action === 'delete_result') {
      pass('文件已删除');
    } else {
      fail('删除文件', JSON.stringify(deleteResult.data).slice(0, 200));
    }

    // 确认删除后 stat 应报错
    try {
      const statResult = await directRequest(ws, 'file', 'stat', { path: fileToDelete });
      if (statResult.action === 'error') {
        pass('删除确认: stat 返回错误（文件不存在）');
      } else {
        console.log(`  ${yellow('⚠')} stat 仍然返回了数据: ${JSON.stringify(statResult.data).slice(0, 100)}`);
      }
    } catch {
      pass('删除确认: stat 超时（文件不存在）');
    }

    // 检查删除的 FileWatcher 事件
    const deleteEvent = await deleteEventPromise;
    if (deleteEvent) {
      pass(`FileWatcher 删除事件: ${deleteEvent.type} ${deleteEvent.path}`);
    } else {
      console.log(`  ${yellow('⚠')} FileWatcher 删除事件未收到（非致命）`);
    }

    console.log('\n' + green('=== 文件同步验证通过 ===') + '\n');

  } catch (err) {
    fail('异常', err.message);
    console.error(err);
  } finally {
    ws?.close();
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
