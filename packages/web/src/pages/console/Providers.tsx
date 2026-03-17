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
  createdAt: string;
  authType?: 'api_key' | 'oauth';
  oauthStatus?: 'authorized' | 'expired' | 'unauthorized';
}

interface ProviderDetail extends Provider {
  config: {
    maskedKey: string;
    baseURL: string;
    models: string[];
  };
}

const SUGGESTED_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250414', 'claude-3-5-sonnet-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  litellm: [],
};

const inputClass = 'block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10';
const labelClass = 'block mb-1 text-[13px] font-medium text-text-primary';

function ModelInputRow({ value, onChange, onAdd }: { value: string; onChange: (v: string) => void; onAdd: () => void }) {
  return (
    <div className="flex gap-2 mb-2">
      <input
        placeholder="输入模型名称，回车添加"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
        className={`${inputClass} flex-1`}
      />
      <Button size="sm" type="button" onClick={onAdd}>添加</Button>
    </div>
  );
}

function ModelSuggestions({ suggestions, onAdd }: { suggestions: string[]; onAdd: (s: string) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1 items-center">
      <span className="text-xs text-text-muted">快捷添加：</span>
      {suggestions.map((s) => (
        <button key={s} type="button" onClick={() => onAdd(s)}
          className="border border-dashed border-slate-300 rounded-full px-2 py-0.5 text-xs text-text-muted hover:border-accent hover:text-accent transition-colors">
          {s}
        </button>
      ))}
    </div>
  );
}

function ModelTagList({ models, onRemove }: { models: string[]; onRemove: (m: string) => void }) {
  if (models.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {models.map((m) => (
        <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft text-accent rounded-full text-[13px]">
          {m}
          <button type="button" onClick={() => onRemove(m)} className="text-accent hover:text-accent-ink text-base leading-none">&times;</button>
        </span>
      ))}
    </div>
  );
}

export function Providers() {
  const [list, setList] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('claude');
  const [authType, setAuthType] = useState<'api_key' | 'oauth'>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editApiBase, setEditApiBase] = useState('');
  const [editMaskedKey, setEditMaskedKey] = useState('');
  const [editModels, setEditModels] = useState<string[]>([]);
  const [editModelInput, setEditModelInput] = useState('');
  const [editType, setEditType] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const showApiBase = type !== 'claude';
  const suggestions = (SUGGESTED_MODELS[type] ?? []).filter((s) => !models.includes(s));

  const load = () => api<Provider[]>('/providers').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const addModel = (model: string, target: 'create' | 'edit') => {
    const m = model.trim();
    if (!m) return;
    if (target === 'create') {
      if (!models.includes(m)) setModels([...models, m]);
      setModelInput('');
    } else {
      if (!editModels.includes(m)) setEditModels([...editModels, m]);
      setEditModelInput('');
    }
  };

  const removeModel = (model: string, target: 'create' | 'edit') => {
    if (target === 'create') setModels(models.filter((m) => m !== model));
    else setEditModels(editModels.filter((m) => m !== model));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name, type, authType, isDefault: list.length === 0 };
    if (authType === 'api_key') {
      body.config = { key: apiKey, ...(apiBase && { baseURL: apiBase }), models };
    } else {
      body.config = { models };
    }
    await api('/providers', { method: 'POST', body: JSON.stringify(body) });
    setShowForm(false);
    setName(''); setApiKey(''); setApiBase(''); setModels([]); setModelInput(''); setAuthType('api_key');
    load();
  };

  const openEdit = async (provider: Provider) => {
    setEditingId(provider.id);
    setEditName(provider.name);
    setEditType(provider.type);
    setEditApiKey('');
    setEditApiBase('');
    setEditMaskedKey('');
    setEditModels([]);
    setEditModelInput('');
    try {
      const detail = await api<ProviderDetail>(`/providers/${provider.id}`);
      setEditMaskedKey(detail.config.maskedKey);
      setEditApiBase(detail.config.baseURL);
      setEditModels(detail.config.models);
    } catch { /* ignore */ }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    const configUpdate: Record<string, unknown> = { models: editModels };
    if (editApiKey) configUpdate.key = editApiKey;
    if (editApiBase !== undefined) configUpdate.baseURL = editApiBase;
    await api(`/providers/${editingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editName || undefined, config: configUpdate }),
    });
    setEditSaving(false);
    setEditingId(null);
    load();
  };

  const editShowApiBase = editType !== 'claude';
  const editSuggestions = (SUGGESTED_MODELS[editType] ?? []).filter((s) => !editModels.includes(s));

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[22px] font-bold">API Key 管理</h2>
          <Button onClick={() => setShowForm(!showForm)}>添加 Provider</Button>
        </div>
        <p className="text-text-muted text-sm">管理 AI 服务供应商</p>
      </div>

      <div className="px-7 py-6">
        {showForm && (
          <form onSubmit={handleCreate} className="bg-slate-50 border border-line rounded-2xl p-5 mb-5">
            <div className="mb-3">
              <label className={labelClass}>Provider 类型</label>
              <select value={type} onChange={(e) => { setType(e.target.value); setModels([]); }} className={inputClass}>
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek</option>
                <option value="litellm">LiteLLM</option>
              </select>
            </div>
            <div className="mb-3">
              <label className={labelClass}>认证方式</label>
              <select value={authType} onChange={e => setAuthType(e.target.value as 'api_key' | 'oauth')} className={inputClass}>
                <option value="api_key">API Key</option>
                <option value="oauth">OAuth 登录</option>
              </select>
            </div>
            {authType === 'oauth' ? (
              <div className="mb-3">
                <label className={labelClass}>OAuth 授权</label>
                <Button type="button" onClick={() => window.open(`/api/oauth/${type}/authorize`, '_blank', 'width=600,height=700')}>
                  🔐 授权 {type === 'claude' ? 'Claude' : type}
                </Button>
                <p className="text-xs text-text-muted mt-1">点击后将跳转到{type}官方授权页面</p>
              </div>
            ) : (
              <div className="mb-3">
                <label className={labelClass}>API Key</label>
                <input placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} required type="password" className={inputClass} />
              </div>
            )}
            {showApiBase && authType === 'api_key' && (
              <div className="mb-3">
                <label className={labelClass}>API Base URL</label>
                <input placeholder="如：https://your-litellm-proxy.com/v1" value={apiBase} onChange={(e) => setApiBase(e.target.value)} className={inputClass} />
                <span className="text-xs text-text-muted mt-1 block">选填，留空使用官方默认地址</span>
              </div>
            )}
            <div className="mb-3">
              <label className={labelClass}>模型列表</label>
              <ModelInputRow value={modelInput} onChange={setModelInput} onAdd={() => addModel(modelInput, 'create')} />
              <ModelSuggestions suggestions={suggestions} onAdd={(s) => addModel(s, 'create')} />
              <ModelTagList models={models} onRemove={(m) => removeModel(m, 'create')} />
            </div>
            <div className="mb-3">
              <label className={labelClass}>备注</label>
              <input placeholder="选填" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>
            <Button type="submit">保存</Button>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                {['名称', '类型', '默认', '授权状态', '创建时间', '操作'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 text-sm">
                    <div className="font-medium">{p.name || '-'}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {['vision', 'toolUse', 'thinking'].map(cap => (
                        <span key={cap} className="px-1.5 py-px rounded-md text-[11px] bg-slate-100 text-text-muted">
                          {cap === 'vision' ? '👁 视觉' : cap === 'toolUse' ? '🔧 工具' : '🧠 思考'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-sm">{p.type}</td>
                  <td className="px-3 py-2.5 text-sm">{p.isDefault ? '是' : '-'}</td>
                  <td className="px-3 py-2.5 text-sm">
                    {p.authType === 'oauth' && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                        p.oauthStatus === 'authorized'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}>
                        {p.oauthStatus === 'authorized' ? '已授权' : p.oauthStatus === 'expired' ? '已过期' : '未授权'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => openEdit(p)} className="text-accent text-[13px] hover:underline mr-3">编辑</button>
                    <button onClick={() => api(`/providers/${p.id}`, { method: 'DELETE' }).then(load)} className="text-danger text-[13px] hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Modal open={!!editingId} onClose={() => setEditingId(null)} title="编辑 Provider" width="max-w-lg">
          <div className="mb-3">
            <label className={labelClass}>备注</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputClass} />
          </div>
          <div className="mb-3">
            <label className={labelClass}>API Key</label>
            <input
              placeholder={editMaskedKey ? `当前：${editMaskedKey}（留空不修改）` : '输入新的 API Key'}
              value={editApiKey}
              onChange={(e) => setEditApiKey(e.target.value)}
              type="password"
              className={inputClass}
            />
            <span className="text-xs text-text-muted mt-1 block">留空则保持原有 Key 不变</span>
          </div>
          {editShowApiBase && (
            <div className="mb-3">
              <label className={labelClass}>API Base URL</label>
              <input placeholder="如：https://your-litellm-proxy.com/v1" value={editApiBase} onChange={(e) => setEditApiBase(e.target.value)} className={inputClass} />
            </div>
          )}
          <div className="mb-3">
            <label className={labelClass}>模型列表</label>
            <ModelInputRow value={editModelInput} onChange={setEditModelInput} onAdd={() => addModel(editModelInput, 'edit')} />
            <ModelSuggestions suggestions={editSuggestions} onAdd={(s) => addModel(s, 'edit')} />
            <ModelTagList models={editModels} onRemove={(m) => removeModel(m, 'edit')} />
            {editModels.length === 0 && <p className="text-sm text-text-muted mt-2">暂无模型，请添加</p>}
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={saveEdit} disabled={editSaving}>{editSaving ? '保存中...' : '保存'}</Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>取消</Button>
          </div>
        </Modal>
      </div>
    </ContentPageShell>
  );
}
