import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

interface Provider {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  gitRepo?: string;
  settings?: { providerId?: string; model?: string };
  createdAt: string;
}

export function Workspaces() {
  const [list, setList] = useState<Workspace[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [gitRepo, setGitRepo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsProviderId, setSettingsProviderId] = useState('');
  const [settingsModel, setSettingsModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const load = () => {
    api<Workspace[]>('/workspaces').then(setList).catch(() => {});
    api<Provider[]>('/providers').then(setProviders).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/workspaces', { method: 'POST', body: JSON.stringify({ name, gitRepo: gitRepo || undefined }) });
    setShowForm(false);
    setName(''); setGitRepo('');
    load();
  };

  const loadModels = async (providerId: string) => {
    if (!providerId) { setModelList([]); return; }
    setModelsLoading(true);
    try {
      const data = await api<{ models: string[] }>(`/providers/${providerId}/models`);
      setModelList(data.models ?? []);
    } catch {
      setModelList([]);
    }
    setModelsLoading(false);
  };

  const openSettings = (ws: Workspace) => {
    setEditingId(ws.id);
    setSettingsProviderId(ws.settings?.providerId ?? '');
    setSettingsModel(ws.settings?.model ?? '');
    setModelList([]);
    if (ws.settings?.providerId) loadModels(ws.settings.providerId);
  };

  const handleProviderChange = (providerId: string) => {
    setSettingsProviderId(providerId);
    setSettingsModel('');
    loadModels(providerId);
  };

  const saveSettings = async () => {
    if (!editingId) return;
    setSaving(true);
    await api(`/workspaces/${editingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ settings: { providerId: settingsProviderId || undefined, model: settingsModel || undefined } }),
    });
    setSaving(false);
    setEditingId(null);
    load();
  };

  const selectedProvider = providers.find((p) => p.id === settingsProviderId);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await api(`/workspaces/${id}`, { method: 'DELETE' });
      setDeleteConfirmId(null);
      load();
    } catch {
      // 静默处理
    }
  };

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[22px] font-bold">工作区</h2>
          <Button onClick={() => setShowForm(!showForm)}>新建工作区</Button>
        </div>
        <p className="text-text-muted text-sm">管理你的工作区</p>
      </div>

      <div className="px-7 py-6">
        {showForm && (
          <form onSubmit={handleCreate} className="bg-slate-50 border border-line rounded-2xl p-5 mb-5">
            <div className="mb-3">
              <label className="block mb-1 text-[13px] font-medium text-text-primary">名称</label>
              <input placeholder="如：合同审查项目" value={name} onChange={(e) => setName(e.target.value)} required
                className="block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10" />
            </div>
            <div className="mb-3">
              <label className="block mb-1 text-[13px] font-medium text-text-primary">Git 仓库地址（可选）</label>
              <input placeholder="https://github.com/..." value={gitRepo} onChange={(e) => setGitRepo(e.target.value)}
                className="block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10" />
            </div>
            <Button type="submit">创建</Button>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                <th className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">名称</th>
                <th className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">Slug</th>
                <th className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">模型</th>
                <th className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">Git</th>
                <th className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((ws) => {
                const wsProvider = providers.find((p) => p.id === ws.settings?.providerId);
                return (
                  <tr key={ws.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="px-3 py-2.5 text-sm font-medium">{ws.name}</td>
                    <td className="px-3 py-2.5 text-sm"><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{ws.slug}</code></td>
                    <td className="px-3 py-2.5 text-sm">
                      {ws.settings?.model
                        ? <span>{ws.settings.model}<span className="text-text-muted text-xs ml-1">{wsProvider ? `(${wsProvider.name || wsProvider.type})` : ''}</span></span>
                        : <span className="text-text-soft text-xs">未配置</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-text-muted">{ws.gitRepo || '-'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openSettings(ws)} className="text-accent text-[13px] hover:underline">设置</button>
                        <button onClick={() => setDeleteConfirmId(ws.id)} className="text-red-400 text-[13px] hover:text-red-600 hover:underline transition-colors">删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 删除确认弹窗 */}
        <Modal open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)} title="删除工作区" width="max-w-sm">
          <p className="text-sm text-text-primary mb-4">
            确认删除工作区「<strong>{list.find((w) => w.id === deleteConfirmId)?.name}</strong>」？此操作不可恢复。
          </p>
          <div className="flex gap-2">
            <Button onClick={() => handleDelete(deleteConfirmId!)} className="bg-red-500 hover:bg-red-600 text-white">删除</Button>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>取消</Button>
          </div>
        </Modal>

        <Modal open={!!editingId} onClose={() => setEditingId(null)} title="工作区模型设置" width="max-w-md">
          <div className="mb-3">
            <label className="block mb-1 text-[13px] font-medium">Provider</label>
            <select value={settingsProviderId} onChange={(e) => handleProviderChange(e.target.value)}
              className="block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300">
              <option value="">使用全局默认</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.type}{p.isDefault ? ' (默认)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="mb-3">
            <label className="block mb-1 text-[13px] font-medium">模型</label>
            {modelsLoading ? (
              <p className="text-sm text-text-muted">加载中...</p>
            ) : modelList.length > 0 ? (
              <select value={settingsModel} onChange={(e) => setSettingsModel(e.target.value)}
                className="block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300">
                <option value="">使用全局默认</option>
                {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input
                placeholder={selectedProvider ? '该 Provider 未配置模型，可手动输入' : '请先选择 Provider'}
                value={settingsModel}
                onChange={(e) => setSettingsModel(e.target.value)}
                disabled={!settingsProviderId}
                className="block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 disabled:opacity-50"
              />
            )}
            <span className="text-xs text-text-muted mt-1 block">留空则使用「设置」页的全局默认模型</span>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={saveSettings} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>取消</Button>
          </div>
        </Modal>
      </div>
    </ContentPageShell>
  );
}
