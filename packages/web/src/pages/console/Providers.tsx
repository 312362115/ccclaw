import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Provider {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  createdAt: string;
}

export function Providers() {
  const [list, setList] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('claude');
  const [apiKey, setApiKey] = useState('');

  const load = () => api<Provider[]>('/providers').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/providers', {
      method: 'POST',
      body: JSON.stringify({ name, type, config: { key: apiKey }, isDefault: list.length === 0 }),
    });
    setShowForm(false);
    setName(''); setApiKey('');
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>API Key 管理</h2>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>添加 Provider</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
            <option value="claude">Claude</option>
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
          </select>
          <input placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required type="password" style={inputStyle} />
          <button type="submit" style={btnStyle}>保存</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>类型</th>
            <th style={thStyle}>默认</th>
            <th style={thStyle}>创建时间</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>{p.name}</td>
              <td style={tdStyle}>{p.type}</td>
              <td style={tdStyle}>{p.isDefault ? '是' : '-'}</td>
              <td style={tdStyle}>{new Date(p.createdAt).toLocaleDateString()}</td>
              <td style={tdStyle}>
                <button onClick={() => api(`/providers/${p.id}`, { method: 'DELETE' }).then(load)} style={{ background: 'none', border: 'none', color: '#d93025', cursor: 'pointer', fontSize: 13 }}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '6px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', marginBottom: 8, border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
