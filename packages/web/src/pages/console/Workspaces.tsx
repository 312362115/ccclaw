import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  gitRepo?: string;
  createdAt: string;
}

export function Workspaces() {
  const [list, setList] = useState<Workspace[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [gitRepo, setGitRepo] = useState('');

  const load = () => api<Workspace[]>('/workspaces').then(setList).catch(() => {});

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/workspaces', { method: 'POST', body: JSON.stringify({ name, slug, gitRepo: gitRepo || undefined }) });
    setShowForm(false);
    setName(''); setSlug(''); setGitRepo('');
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>工作区</h2>
        <button onClick={() => setShowForm(!showForm)} style={btnStyle}>新建工作区</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
          <input placeholder="slug（英文标识）" value={slug} onChange={(e) => setSlug(e.target.value)} required style={inputStyle} />
          <input placeholder="Git 仓库地址（可选）" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} style={inputStyle} />
          <button type="submit" style={btnStyle}>创建</button>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>Slug</th>
            <th style={thStyle}>Git</th>
            <th style={thStyle}>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {list.map((ws) => (
            <tr key={ws.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyle}>{ws.name}</td>
              <td style={tdStyle}><code>{ws.slug}</code></td>
              <td style={tdStyle}>{ws.gitRepo || '-'}</td>
              <td style={tdStyle}>{new Date(ws.createdAt).toLocaleDateString()}</td>
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
