import { useState, useEffect } from 'react';
import { api } from '../../api/client';

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

// 各类型的常见模型建议（仅辅助快捷添加）
const SUGGESTED_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250414', 'claude-3-5-sonnet-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  litellm: [],
};

export function Providers() {
  const [list, setList] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);

  // 创建表单
  const [name, setName] = useState('');
  const [type, setType] = useState('claude');
  const [authType, setAuthType] = useState<'api_key' | 'oauth'>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState('');

  // 编辑弹窗
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
    const body: Record<string, unknown> = {
      name, type,
      authType,
      isDefault: list.length === 0,
    };
    if (authType === 'api_key') {
      body.config = { key: apiKey, ...(apiBase && { baseURL: apiBase }), models };
    } else {
      body.config = { models };
    }
    await api('/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    });
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
      body: JSON.stringify({
        name: editName || undefined,
        config: configUpdate,
      }),
    });
    setEditSaving(false);
    setEditingId(null);
    load();
  };

  const editShowApiBase = editType !== 'claude';
  const editSuggestions = (SUGGESTED_MODELS[editType] ?? []).filter((s) => !editModels.includes(s));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>API Key 管理</h2>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>添加 Provider</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Provider 类型</label>
            <select value={type} onChange={(e) => { setType(e.target.value); setModels([]); }} style={inputStyle}>
              <option value="claude">Claude</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="litellm">LiteLLM</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>认证方式</label>
            <select
              value={authType}
              onChange={e => setAuthType(e.target.value as 'api_key' | 'oauth')}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}
            >
              <option value="api_key">API Key</option>
              <option value="oauth">OAuth 登录</option>
            </select>
          </div>
          {authType === 'oauth' ? (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>OAuth 授权</label>
              <button
                type="button"
                onClick={() => {
                  window.open(`/api/oauth/${type}/authorize`, '_blank', 'width=600,height=700');
                }}
                style={{
                  padding: '10px 20px',
                  background: '#1a73e8',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                🔐 授权 {type === 'claude' ? 'Claude' : type === 'gemini' ? 'Google' : type === 'qwen' ? '通义千问' : type}
              </button>
              <p style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                点击后将跳转到{type}官方授权页面
              </p>
            </div>
          ) : (
            <div style={fieldStyle}>
              <label style={labelStyle}>API Key</label>
              <input placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} required type="password" style={inputStyle} />
            </div>
          )}
          {showApiBase && authType === 'api_key' && (
            <div style={fieldStyle}>
              <label style={labelStyle}>API Base URL</label>
              <input placeholder="如：https://your-litellm-proxy.com/v1" value={apiBase} onChange={(e) => setApiBase(e.target.value)} style={inputStyle} />
              <span style={hintStyle}>选填，留空使用官方默认地址</span>
            </div>
          )}
          <div style={fieldStyle}>
            <label style={labelStyle}>模型列表</label>
            <ModelInputRow value={modelInput} onChange={setModelInput} onAdd={() => addModel(modelInput, 'create')} />
            <ModelSuggestions suggestions={suggestions} onAdd={(s) => addModel(s, 'create')} />
            <ModelTagList models={models} onRemove={(m) => removeModel(m, 'create')} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>备注</label>
            <input placeholder="选填" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <button type="submit" style={btnStyle}>保存</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>类型</th>
            <th style={thStyle}>默认</th>
            <th style={thStyle}>授权状态</th>
            <th style={thStyle}>创建时间</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>
                <div>{p.name || '-'}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {['vision', 'toolUse', 'thinking'].map(cap => (
                    <span key={cap} style={{
                      padding: '1px 6px',
                      borderRadius: 8,
                      fontSize: 11,
                      background: '#f0f0f0',
                      color: '#666',
                    }}>
                      {cap === 'vision' ? '👁 视觉' : cap === 'toolUse' ? '🔧 工具' : '🧠 思考'}
                    </span>
                  ))}
                </div>
              </td>
              <td style={tdStyle}>{p.type}</td>
              <td style={tdStyle}>{p.isDefault ? '是' : '-'}</td>
              <td style={tdStyle}>
                {p.authType === 'oauth' && (
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 12,
                    background: p.oauthStatus === 'authorized' ? '#e6f4ea' : '#fce8e6',
                    color: p.oauthStatus === 'authorized' ? '#137333' : '#c5221f',
                  }}>
                    {p.oauthStatus === 'authorized' ? '已授权' :
                     p.oauthStatus === 'expired' ? '已过期' : '未授权'}
                  </span>
                )}
              </td>
              <td style={tdStyle}>{new Date(p.createdAt).toLocaleDateString()}</td>
              <td style={tdStyle}>
                <button onClick={() => openEdit(p)} style={linkBtnStyle}>编辑</button>
                <button onClick={() => api(`/providers/${p.id}`, { method: 'DELETE' }).then(load)} style={{ ...linkBtnStyle, color: '#d93025', marginLeft: 12 }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 编辑弹窗 */}
      {editingId && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ marginTop: 0 }}>编辑 Provider</h3>

            <div style={fieldStyle}>
              <label style={labelStyle}>备注</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>API Key</label>
              <input
                placeholder={editMaskedKey ? `当前：${editMaskedKey}（留空不修改）` : '输入新的 API Key'}
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
                type="password"
                style={inputStyle}
              />
              <span style={hintStyle}>留空则保持原有 Key 不变</span>
            </div>

            {editShowApiBase && (
              <div style={fieldStyle}>
                <label style={labelStyle}>API Base URL</label>
                <input
                  placeholder="如：https://your-litellm-proxy.com/v1"
                  value={editApiBase}
                  onChange={(e) => setEditApiBase(e.target.value)}
                  style={inputStyle}
                />
              </div>
            )}

            <div style={fieldStyle}>
              <label style={labelStyle}>模型列表</label>
              <ModelInputRow value={editModelInput} onChange={setEditModelInput} onAdd={() => addModel(editModelInput, 'edit')} />
              <ModelSuggestions suggestions={editSuggestions} onAdd={(s) => addModel(s, 'edit')} />
              <ModelTagList models={editModels} onRemove={(m) => removeModel(m, 'edit')} />
              {editModels.length === 0 && (
                <p style={{ fontSize: 13, color: '#999', margin: '8px 0 0' }}>暂无模型，请添加</p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={saveEdit} disabled={editSaving} style={btnStyle}>{editSaving ? '保存中...' : '保存'}</button>
              <button onClick={() => setEditingId(null)} style={{ ...btnStyle, background: '#666' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelInputRow({ value, onChange, onAdd }: { value: string; onChange: (v: string) => void; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      <input
        placeholder="输入模型名称，回车添加"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
        style={{ ...inputStyle, flex: 1 }}
      />
      <button type="button" onClick={onAdd} style={{ ...btnStyle, padding: '6px 12px' }}>添加</button>
    </div>
  );
}

function ModelSuggestions({ suggestions, onAdd }: { suggestions: string[]; onAdd: (s: string) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={hintStyle}>快捷添加：</span>
      {suggestions.map((s) => (
        <button key={s} type="button" onClick={() => onAdd(s)} style={tagBtnStyle}>{s}</button>
      ))}
    </div>
  );
}

function ModelTagList({ models, onRemove }: { models: string[]; onRemove: (m: string) => void }) {
  if (models.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {models.map((m) => (
        <span key={m} style={tagStyle}>
          {m}
          <button type="button" onClick={() => onRemove(m)} style={tagRemoveStyle}>&times;</button>
        </span>
      ))}
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '6px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 };
const linkBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 13, padding: 0 };
const fieldStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#333' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 12, color: '#888' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
const tagStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#e8f0fe', color: '#1a73e8', borderRadius: 12, fontSize: 13 };
const tagRemoveStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 };
const tagBtnStyle: React.CSSProperties = { background: 'none', border: '1px dashed #ccc', borderRadius: 12, padding: '2px 8px', fontSize: 12, color: '#666', cursor: 'pointer', marginLeft: 4 };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 };
const modalStyle: React.CSSProperties = { background: '#fff', padding: 24, borderRadius: 8, width: 500, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' };
