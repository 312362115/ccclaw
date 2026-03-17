import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  workspaceId?: string;
  updatedAt: string;
  version?: string;
  latestVersion?: string;
  source?: 'builtin' | 'marketplace' | 'user';
}

export function Skills() {
  const [list, setList] = useState<Skill[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const load = () => api<Skill[]>('/skills').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setName('');
    setDescription('');
    setContent('');
    setEditingSkill(null);
    setShowForm(false);
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setName(skill.name);
    setDescription(skill.description);
    setContent(skill.content);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSkill) {
      await api(`/skills/${editingSkill.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description, content }),
      });
    } else {
      await api('/skills', {
        method: 'POST',
        body: JSON.stringify({ name, description, content }),
      });
    }
    resetForm();
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>技能管理</h2>
        <button
          onClick={() => {
            if (showForm && !editingSkill) {
              resetForm();
            } else {
              resetForm();
              setShowForm(true);
            }
          }}
          style={btnStyle}
        >
          新建技能
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>
              {editingSkill ? '编辑技能' : '创建技能'}
            </span>
            <button type="button" onClick={resetForm} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#999', lineHeight: 1 }}>×</button>
          </div>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={btnStyle}>保存</button>
            <button type="button" onClick={resetForm} style={{ ...btnStyle, background: '#f0f0f0', color: '#333' }}>取消</button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>描述</th>
            <th style={thStyle}>类型</th>
            <th style={thStyle}>来源</th>
            <th style={thStyle}>版本</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>{s.name}</td>
              <td style={tdStyle}>{s.description}</td>
              <td style={tdStyle}>
                <span style={{ marginRight: 4 }}>
                  {s.content?.includes('command:') ? '⚡' : '📖'}
                </span>
                <span style={{ fontSize: 12, color: '#888' }}>
                  {s.content?.includes('command:') ? '可执行' : '知识'}
                </span>
              </td>
              <td style={tdStyle}>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  background: s.source === 'builtin' ? '#e8f0fe' :
                              s.source === 'marketplace' ? '#e6f4ea' : '#f5f5f5',
                  color: s.source === 'builtin' ? '#1a73e8' :
                         s.source === 'marketplace' ? '#137333' : '#666',
                }}>
                  {s.source === 'builtin' ? '系统预置' :
                   s.source === 'marketplace' ? '市场' : '自建'}
                </span>
              </td>
              <td style={{ padding: '8px 12px', fontSize: 13, color: '#666' }}>
                {s.version || '-'}
                {s.latestVersion && s.version !== s.latestVersion && (
                  <span style={{
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 8,
                    fontSize: 11,
                    background: '#fff3e0',
                    color: '#e65100',
                  }}>
                    可更新 → {s.latestVersion}
                  </span>
                )}
              </td>
              <td style={tdStyle}>
                <button
                  onClick={() => handleEdit(s)}
                  style={{ background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 13, marginRight: 8 }}
                >
                  编辑
                </button>
                <button
                  onClick={() => api(`/skills/${s.id}`, { method: 'DELETE' }).then(load)}
                  style={{ background: 'none', border: 'none', color: '#d93025', cursor: 'pointer', fontSize: 13 }}
                >
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
