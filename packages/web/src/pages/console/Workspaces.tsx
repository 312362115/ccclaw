import { useState, useEffect } from 'react';
import { api } from '../../api/client';

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>工作区</h2>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>新建工作区</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={cardStyle}>
          <div style={fieldStyle}>
            <label style={labelStyle}>名称</label>
            <input placeholder="如：合同审查项目" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Git 仓库地址（可选）</label>
            <input placeholder="https://github.com/..." value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} style={inputStyle} />
          </div>
          <button type="submit" style={btnStyle}>创建</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>Slug</th>
            <th style={thStyle}>模型</th>
            <th style={thStyle}>Git</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((ws) => {
            const wsProvider = providers.find((p) => p.id === ws.settings?.providerId);
            return (
              <tr key={ws.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={tdStyle}>{ws.name}</td>
                <td style={tdStyle}><code>{ws.slug}</code></td>
                <td style={tdStyle}>
                  {ws.settings?.model
                    ? <span>{ws.settings.model}<span style={{ color: '#888', fontSize: 12 }}>{wsProvider ? ` (${wsProvider.name || wsProvider.type})` : ''}</span></span>
                    : <span style={{ color: '#999' }}>未配置</span>}
                </td>
                <td style={tdStyle}>{ws.gitRepo || '-'}</td>
                <td style={tdStyle}>
                  <button onClick={() => openSettings(ws)} style={linkBtnStyle}>设置</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editingId && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ marginTop: 0 }}>工作区模型设置</h3>
            <div style={fieldStyle}>
              <label style={labelStyle}>Provider</label>
              <select
                value={settingsProviderId}
                onChange={(e) => handleProviderChange(e.target.value)}
                style={inputStyle}
              >
                <option value="">使用全局默认</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || p.type}{p.isDefault ? ' (默认)' : ''}</option>
                ))}
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>模型</label>
              {modelsLoading ? (
                <p style={{ fontSize: 13, color: '#999', margin: 0 }}>加载中...</p>
              ) : modelList.length > 0 ? (
                <select value={settingsModel} onChange={(e) => setSettingsModel(e.target.value)} style={inputStyle}>
                  <option value="">使用全局默认</option>
                  {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input
                  placeholder={selectedProvider ? '该 Provider 未配置模型，可手动输入' : '请先选择 Provider'}
                  value={settingsModel}
                  onChange={(e) => setSettingsModel(e.target.value)}
                  style={inputStyle}
                  disabled={!settingsProviderId}
                />
              )}
              <span style={hintStyle}>留空则使用「设置」页的全局默认模型</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={saveSettings} disabled={saving} style={btnStyle}>{saving ? '保存中...' : '保存'}</button>
              <button onClick={() => setEditingId(null)} style={{ ...btnStyle, background: '#666' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '6px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 };
const linkBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 13, padding: 0 };
const cardStyle: React.CSSProperties = { background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 };
const fieldStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#333' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 12, color: '#888', marginTop: 2, display: 'block' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 };
const modalStyle: React.CSSProperties = { background: '#fff', padding: 24, borderRadius: 8, width: 420, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' };
