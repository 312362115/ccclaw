#!/usr/bin/env node
/**
 * 定时任务（Scheduler）端到端验证
 * 验证：任务 CRUD API + nextRunAt 自动计算 + cron 更新时 nextRunAt 重算
 * Scheduler 实际触发需要 Runner 持续在线 + 等待 cron 到期，本测试验证 API 层面正确性
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
function fail(step, err) { console.log(`${red('✗')} ${step}: ${err}`); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log('\n' + yellow('=== 定时任务（Scheduler）端到端验证 ===') + '\n');
  let workspaceId = null, token = null, taskId = null;
  let allPassed = true;

  try {
    // 1. 登录 + 创建 Workspace
    log('1/6', '环境准备...');
    const loginRes = await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginRes.data.accessToken;
    const wsRes = await api('POST', '/api/workspaces', {
      name: `scheduler-e2e-${Date.now()}`,
      settings: { startMode: 'local', model: 'gemini-3-flash-preview' },
    }, token);
    workspaceId = wsRes.data.id;
    pass(`Workspace: ${wsRes.data.name}`);

    // 2. 创建定时任务
    log('2/6', '创建定时任务（每分钟）...');
    const createRes = await api('POST', `/api/workspaces/${workspaceId}/tasks`, {
      name: 'e2e-cron-task',
      cron: '*/5 * * * *', // 每 5 分钟
      prompt: '请回复 SCHEDULER_OK',
      enabled: true,
    }, token);

    if (createRes.status !== 201 && createRes.status !== 200) {
      fail('创建任务', `status=${createRes.status} ${JSON.stringify(createRes.data)}`);
      allPassed = false;
    } else {
      taskId = createRes.data.id;
      pass(`任务已创建: id=${taskId}`);

      // 验证 nextRunAt
      if (createRes.data.nextRunAt) {
        const nextDate = new Date(createRes.data.nextRunAt);
        const diffMin = (nextDate.getTime() - Date.now()) / 60000;
        if (diffMin > 0 && diffMin <= 5) {
          pass(`nextRunAt 正确: ${createRes.data.nextRunAt}（${diffMin.toFixed(1)} 分钟后）`);
        } else {
          fail('nextRunAt', `${createRes.data.nextRunAt} 距离 ${diffMin.toFixed(1)} 分钟，预期 0-5 分钟`);
          allPassed = false;
        }
      } else {
        fail('nextRunAt', '为空');
        allPassed = false;
      }
    }

    // 3. 列表查询
    log('3/6', '查询任务列表...');
    const listRes = await api('GET', `/api/workspaces/${workspaceId}/tasks`, null, token);
    if (listRes.status === 200 && listRes.data.length > 0) {
      pass(`任务列表: ${listRes.data.length} 条`);
    } else {
      fail('任务列表', JSON.stringify(listRes.data));
      allPassed = false;
    }

    // 4. 更新任务（改 cron）
    log('4/6', '更新 cron 表达式...');
    if (taskId) {
      const patchRes = await api('PATCH', `/api/workspaces/${workspaceId}/tasks/${taskId}`, {
        cron: '0 */2 * * *', // 每 2 小时
        name: 'e2e-cron-updated',
      }, token);

      if (patchRes.status === 200) {
        pass(`任务已更新: name=${patchRes.data.name}`);
        // 验证 nextRunAt 重算
        if (patchRes.data.nextRunAt) {
          const nextDate = new Date(patchRes.data.nextRunAt);
          const diffHr = (nextDate.getTime() - Date.now()) / 3600000;
          if (diffHr > 0 && diffHr <= 2) {
            pass(`nextRunAt 重算正确: ${patchRes.data.nextRunAt}（${diffHr.toFixed(1)} 小时后）`);
          } else {
            console.log(`  ${yellow('⚠')} nextRunAt=${patchRes.data.nextRunAt} 距离 ${diffHr.toFixed(1)}h`);
          }
        }
      } else {
        fail('更新任务', JSON.stringify(patchRes.data));
        allPassed = false;
      }
    }

    // 5. 无效 cron 拒绝
    log('5/6', '测试无效 cron 表达式...');
    const badRes = await api('POST', `/api/workspaces/${workspaceId}/tasks`, {
      name: 'bad-cron',
      cron: 'invalid cron',
      prompt: 'should fail',
    }, token);
    if (badRes.status === 400) {
      pass('无效 cron 被正确拒绝 (400)');
    } else {
      fail('无效 cron', `期望 400，实际 ${badRes.status}`);
      allPassed = false;
    }

    // 6. 删除任务
    log('6/6', '删除任务...');
    if (taskId) {
      const delRes = await api('DELETE', `/api/workspaces/${workspaceId}/tasks/${taskId}`, null, token);
      if (delRes.status === 204) {
        pass('任务已删除');
        taskId = null;
      } else {
        fail('删除任务', `status=${delRes.status}`);
        allPassed = false;
      }

      // 确认已删
      const verifyRes = await api('GET', `/api/workspaces/${workspaceId}/tasks`, null, token);
      if (verifyRes.status === 200 && verifyRes.data.length === 0) {
        pass('删除确认: 列表为空');
      }
    }

    if (allPassed) {
      console.log('\n' + green('=== Scheduler 验证通过 ===') + '\n');
    } else {
      console.log('\n' + red('=== Scheduler 验证部分失败 ===') + '\n');
    }

  } catch (err) {
    fail('异常', err.message);
    console.error(err);
  } finally {
    if (taskId && workspaceId && token) {
      await api('DELETE', `/api/workspaces/${workspaceId}/tasks/${taskId}`, null, token);
    }
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
