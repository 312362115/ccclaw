import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Button } from '../../components/ui/Button';

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

const inputClass = 'block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10';
const labelClass = 'block mb-1 text-[13px] font-medium text-text-primary';

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
    setName(''); setDescription(''); setContent('');
    setEditingSkill(null); setShowForm(false);
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
      await api(`/skills/${editingSkill.id}`, { method: 'PATCH', body: JSON.stringify({ name, description, content }) });
    } else {
      await api('/skills', { method: 'POST', body: JSON.stringify({ name, description, content }) });
    }
    resetForm();
    load();
  };

  const sourceColors: Record<string, string> = {
    builtin: 'bg-accent-soft text-accent',
    marketplace: 'bg-emerald-50 text-emerald-700',
    user: 'bg-slate-100 text-text-muted',
  };

  const sourceLabels: Record<string, string> = {
    builtin: '系统预置',
    marketplace: '市场',
    user: '自建',
  };

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[22px] font-bold">技能管理</h2>
          <Button onClick={() => { if (showForm && !editingSkill) resetForm(); else { resetForm(); setShowForm(true); } }}>新建技能</Button>
        </div>
        <p className="text-text-muted text-sm">管理 Agent 技能</p>
      </div>

      <div className="px-7 py-6">
        {showForm && (
          <form onSubmit={handleSave} className="bg-slate-50 border border-line rounded-2xl p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[15px] font-semibold">{editingSkill ? '编辑技能' : '创建技能'}</span>
              <button type="button" onClick={resetForm} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
            </div>
            <div className="mb-3">
              <label className={labelClass}>名称</label>
              <input placeholder="如：合同分析" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>
            <div className="mb-3">
              <label className={labelClass}>描述</label>
              <input placeholder="简要说明技能用途" value={description} onChange={(e) => setDescription(e.target.value)} required className={inputClass} />
            </div>
            <div className="mb-3">
              <label className={labelClass}>技能内容（Markdown）</label>
              <textarea placeholder="在此编写技能提示词..." value={content} onChange={(e) => setContent(e.target.value)} required rows={6}
                className={`${inputClass} resize-y`} />
            </div>
            <div className="flex gap-2">
              <Button type="submit">保存</Button>
              <Button variant="ghost" type="button" onClick={resetForm}>取消</Button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                {['名称', '描述', '类型', '来源', '版本', '操作'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[13px] text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 text-sm font-medium">{s.name}</td>
                  <td className="px-3 py-2.5 text-sm text-text-muted">{s.description}</td>
                  <td className="px-3 py-2.5 text-sm">
                    <span className="mr-1">{s.content?.includes('command:') ? '⚡' : '📖'}</span>
                    <span className="text-xs text-text-muted">{s.content?.includes('command:') ? '可执行' : '知识'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] ${sourceColors[s.source || 'user']}`}>
                      {sourceLabels[s.source || 'user']}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-text-muted">
                    {s.version || '-'}
                    {s.latestVersion && s.version !== s.latestVersion && (
                      <span className="ml-1.5 px-1.5 py-px rounded-md text-[11px] bg-amber-50 text-amber-700">
                        可更新 → {s.latestVersion}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => handleEdit(s)} className="text-accent text-[13px] hover:underline mr-2">编辑</button>
                    <button onClick={() => api(`/skills/${s.id}`, { method: 'DELETE' }).then(load)} className="text-danger text-[13px] hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ContentPageShell>
  );
}
