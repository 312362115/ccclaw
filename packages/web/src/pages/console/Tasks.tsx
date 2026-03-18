import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';

interface ScheduledTask {
  id: string;
  workspaceId: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

const EMPTY_FORM = { name: '', cron: '', prompt: '', enabled: true };

export function Tasks() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);

  // 编辑/新建
  const [editing, setEditing] = useState<string | null>(null); // task id or '__new__'
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 加载工作区列表
  useEffect(() => {
    api<Workspace[]>('/workspaces').then((list) => {
      setWorkspaces(list);
      if (list.length > 0) setSelectedWs(list[0].id);
    }).catch(() => {});
  }, []);

  // 加载任务列表
  const loadTasks = useCallback((wsId: string) => {
    setLoading(true);
    api<ScheduledTask[]>(`/workspaces/${wsId}/tasks`)
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedWs) loadTasks(selectedWs);
  }, [selectedWs, loadTasks]);

  // 新建
  const handleNew = () => {
    setEditing('__new__');
    setForm(EMPTY_FORM);
  };

  // 编辑
  const handleEdit = (task: ScheduledTask) => {
    setEditing(task.id);
    setForm({ name: task.name, cron: task.cron, prompt: task.prompt, enabled: task.enabled });
  };

  // 保存
  const handleSave = async () => {
    if (!selectedWs || !form.name.trim() || !form.cron.trim() || !form.prompt.trim()) return;
    setSaving(true);
    try {
      if (editing === '__new__') {
        await api(`/workspaces/${selectedWs}/tasks`, {
          method: 'POST',
          body: JSON.stringify(form),
        });
      } else {
        await api(`/workspaces/${selectedWs}/tasks/${editing}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
      }
      setEditing(null);
      loadTasks(selectedWs);
    } catch {
      // 静默处理
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (taskId: string) => {
    if (!selectedWs) return;
    await api(`/workspaces/${selectedWs}/tasks/${taskId}`, { method: 'DELETE' }).catch(() => {});
    loadTasks(selectedWs);
  };

  // 启用/禁用
  const handleToggle = async (task: ScheduledTask) => {
    if (!selectedWs) return;
    await api(`/workspaces/${selectedWs}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !task.enabled }),
    }).catch(() => {});
    loadTasks(selectedWs);
  };

  const formatTime = (t: string | null) => {
    if (!t) return '-';
    return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <h2 className="text-[22px] font-bold mb-1.5">定时任务</h2>
        <p className="text-text-muted text-sm">管理工作区的 Cron 定时任务，定期自动执行 Agent 指令</p>
      </div>

      <div className="px-7 py-5">
        {/* 工作区选择 + 新建按钮 */}
        <div className="flex items-center gap-3 mb-5">
          <select
            value={selectedWs ?? ''}
            onChange={(e) => setSelectedWs(e.target.value)}
            className="h-9 border border-line rounded-lg px-3 text-sm bg-white outline-none focus:border-blue-400 transition-colors"
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
          <button
            onClick={handleNew}
            className="h-9 px-4 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
          >
            + 新建任务
          </button>
        </div>

        {/* 编辑表单 */}
        {editing && (
          <div className="mb-5 border border-line rounded-xl p-5 bg-slate-50/50">
            <h3 className="text-sm font-bold mb-4">{editing === '__new__' ? '新建任务' : '编辑任务'}</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">任务名称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：每日摘要"
                  className="w-full h-9 border border-line rounded-lg px-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Cron 表达式</label>
                <input
                  value={form.cron}
                  onChange={(e) => setForm({ ...form, cron: e.target.value })}
                  placeholder="例如：0 9 * * * (每天 9:00)"
                  className="w-full h-9 border border-line rounded-lg px-3 text-sm font-mono outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs text-text-muted mb-1.5">Prompt 指令</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder="Agent 将按此指令执行..."
                rows={3}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors resize-none"
              />
            </div>
            <div className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                id="task-enabled"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="w-4 h-4 accent-blue-500"
              />
              <label htmlFor="task-enabled" className="text-sm text-text-primary">启用</label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="h-9 px-5 border border-line text-sm rounded-lg hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 任务列表 */}
        {loading ? (
          <div className="text-sm text-text-muted text-center py-10">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-text-muted text-center py-10">暂无定时任务</div>
        ) : (
          <div className="border border-line rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-line text-text-muted text-left">
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">Cron</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">上次执行</th>
                  <th className="px-4 py-3 font-medium">下次执行</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-line last:border-b-0 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-primary">{task.name}</div>
                      <div className="text-xs text-text-muted mt-0.5 truncate max-w-[240px]">{task.prompt}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">{task.cron}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(task)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          task.enabled
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${task.enabled ? 'bg-green-500' : 'bg-slate-400'}`} />
                        {task.enabled ? '运行中' : '已停用'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">{formatTime(task.lastRunAt)}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">{formatTime(task.nextRunAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEdit(task)}
                          className="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ContentPageShell>
  );
}
