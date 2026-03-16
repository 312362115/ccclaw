import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Skill {
  id: string;
  name: string;
  description: string;
  workspaceId?: string;
  updatedAt: string;
}

export function Skills() {
  const [list, setList] = useState<Skill[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');

  const load = () => api<Skill[]>('/skills').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/skills', {
      method: 'POST',
      body: JSON.stringify({ name, description, content }),
    });
    setShowForm(false);
    setName(''); setDescription(''); setContent('');
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>技能管理</h2>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>新建技能</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>名称</label>
            <input placeholder="如：合同分析" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>描述</label>
            <input placeholder="简要说明技能用途" value={description} onChange={(e) => setDescription(e.target.value)} required style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>技能内容（Markdown）</label>
            <textarea placeholder="在此编写技能提示词..." value={content} onChange={(e) => setContent(e.target.value)} required rows={6} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <button type="submit" style={btnStyle}>保存</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>描述</th>
            <th style={thStyle}>范围</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>{s.name}</td>
              <td style={tdStyle}>{s.description}</td>
              <td style={tdStyle}>{s.workspaceId ? '工作区级' : '用户级'}</td>
              <td style={tdStyle}>
                <button onClick={() => api(`/skills/${s.id}`, { method: 'DELETE' }).then(load)} style={{ background: 'none', border: 'none', color: '#d93025', cursor: 'pointer', fontSize: 13 }}>
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
const fieldStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#333' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 14 };
