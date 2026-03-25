import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Button } from '../../components/ui/Button';

interface Preferences {
  agentModel: string | null;
  maxTokens: number | null;
  temperature: number | null;
  reasoningEffort: string | null;
  toolConfirmMode: string | null;
}

const defaultPrefs: Preferences = {
  agentModel: null,
  maxTokens: null,
  temperature: null,
  reasoningEffort: null,
  toolConfirmMode: null,
};

// ====== MCP Types ======

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string> | null;
  enabled: boolean;
  workspaceId: string | null;
}

// ====== Skill Types ======

interface Skill {
  id: string;
  name: string;
  description: string;
  workspaceId: string | null;
}

const inputClass = 'block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10';
const labelClass = 'block mb-1 text-[13px] font-medium text-text-primary';

export function Settings() {
  const user = useAuthStore((s) => s.user);
  const [prefs, setPrefs] = useState<Preferences>(defaultPrefs);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: '', command: '', args: '' });

  // Skill import state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showSkillImport, setShowSkillImport] = useState(false);
  const [skillUrl, setSkillUrl] = useState('');
  const [skillImporting, setSkillImporting] = useState(false);
  const [skillImportMsg, setSkillImportMsg] = useState('');

  useEffect(() => {
    api<Preferences>('/settings/preferences').then((data) => {
      setPrefs({ ...defaultPrefs, ...data });
    }).catch(() => {});

    loadMcpServers();
    loadSkills();
  }, []);

  const loadMcpServers = () => {
    api<MCPServer[]>('/mcp-servers').then(setMcpServers).catch(() => {});
  };

  const loadSkills = () => {
    api<Skill[]>('/skills').then(setSkills).catch(() => {});
  };

  const savePrefs = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api('/settings/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  // ====== MCP Handlers ======

  const addMcpServer = async () => {
    if (!mcpForm.name || !mcpForm.command) return;
    try {
      await api('/mcp-servers', {
        method: 'POST',
        body: JSON.stringify({
          name: mcpForm.name,
          command: mcpForm.command,
          args: mcpForm.args ? mcpForm.args.split(/\s+/).filter(Boolean) : [],
        }),
      });
      setMcpForm({ name: '', command: '', args: '' });
      setShowMcpForm(false);
      loadMcpServers();
    } catch { /* ignore */ }
  };

  const toggleMcp = async (id: string, enabled: boolean) => {
    await api(`/mcp-servers/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    loadMcpServers();
  };

  const deleteMcp = async (id: string) => {
    await api(`/mcp-servers/${id}`, { method: 'DELETE' });
    loadMcpServers();
  };

  // ====== Skill Import Handler ======

  const importSkill = async () => {
    if (!skillUrl.trim()) return;
    setSkillImporting(true);
    setSkillImportMsg('');
    try {
      // 从 URL 获取内容
      const resp = await fetch(skillUrl.trim());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const markdown = await resp.text();

      // 解析 frontmatter（简单解析）
      const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (!match) throw new Error('无效的 Skill 文件格式（缺少 frontmatter）');

      const meta: Record<string, string> = {};
      for (const line of match[1].split('\n')) {
        const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
        if (kv) meta[kv[1]] = kv[2].trim();
      }

      if (!meta.name || !meta.description) throw new Error('Skill 缺少 name 或 description');

      // 创建 Skill
      await api('/skills', {
        method: 'POST',
        body: JSON.stringify({
          name: meta.name,
          description: meta.description,
          content: match[2].trim(),
        }),
      });

      setSkillImportMsg(`导入成功: ${meta.name}`);
      setSkillUrl('');
      setShowSkillImport(false);
      loadSkills();
    } catch (err: any) {
      setSkillImportMsg(`导入失败: ${err.message}`);
    }
    setSkillImporting(false);
  };

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <h2 className="text-[22px] font-bold mb-1.5">设置</h2>
        <p className="text-text-muted text-sm">个人偏好与账户设置</p>
      </div>

      <div className="px-7 py-6 flex flex-col gap-4">
        {/* 个人信息 */}
        <div className="bg-slate-50 border border-line rounded-2xl p-5">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">👤 个人信息</h3>
          <div className="flex items-center justify-between py-2.5 border-b border-line-soft text-[13px]">
            <span>姓名</span>
            <span className="text-text-muted text-xs">{user?.name}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-b border-line-soft text-[13px]">
            <span>邮箱</span>
            <span className="text-text-muted text-xs">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 text-[13px]">
            <span>角色</span>
            <span className="text-text-muted text-xs">{user?.role === 'admin' ? '管理员' : '用户'}</span>
          </div>
        </div>

        {/* 模型配置 */}
        <div className="bg-slate-50 border border-line rounded-2xl p-5">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">🤖 模型配置</h3>
          <div className="mb-3">
            <label className={labelClass}>默认模型</label>
            <input
              placeholder="如：claude-sonnet-4-20250514、gpt-4o、deepseek-chat"
              value={prefs.agentModel ?? ''}
              onChange={(e) => setPrefs({ ...prefs, agentModel: e.target.value || null })}
              className={inputClass}
            />
            <span className="text-xs text-text-muted mt-1 block">留空则使用系统默认模型</span>
          </div>
          <div className="mb-3">
            <label className={labelClass}>最大输出 Token</label>
            <input
              type="number"
              placeholder="如：4096"
              value={prefs.maxTokens ?? ''}
              onChange={(e) => setPrefs({ ...prefs, maxTokens: e.target.value ? Number(e.target.value) : null })}
              className={inputClass}
            />
          </div>
          <div className="mb-3">
            <label className={labelClass}>Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              placeholder="0 ~ 2，默认 1"
              value={prefs.temperature ?? ''}
              onChange={(e) => setPrefs({ ...prefs, temperature: e.target.value ? Number(e.target.value) : null })}
              className={inputClass}
            />
          </div>
        </div>

        {/* 推理配置 */}
        <div className="bg-slate-50 border border-line rounded-2xl p-5">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">🧠 推理配置</h3>
          <div className="mb-3">
            <label className={labelClass}>推理深度</label>
            <select
              value={prefs.reasoningEffort ?? ''}
              onChange={(e) => setPrefs({ ...prefs, reasoningEffort: e.target.value || null })}
              className={inputClass}
            >
              <option value="">默认</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
            <span className="text-xs text-text-muted mt-1 block">仅支持推理模型（如 Claude 3.5+ extended thinking）</span>
          </div>
        </div>

        {/* 安全设置 */}
        <div className="bg-slate-50 border border-line rounded-2xl p-5">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">🔒 安全设置</h3>
          <div className="mb-3">
            <label className={labelClass}>工具确认模式</label>
            <select
              value={prefs.toolConfirmMode ?? ''}
              onChange={(e) => setPrefs({ ...prefs, toolConfirmMode: e.target.value || null })}
              className={inputClass}
            >
              <option value="">默认（自动执行）</option>
              <option value="always">每次确认</option>
              <option value="dangerous">仅危险操作确认</option>
            </select>
          </div>
        </div>

        <div>
          <Button onClick={savePrefs} disabled={saving}>
            {saving ? '保存中...' : saved ? '已保存 ✓' : '保存配置'}
          </Button>
        </div>

        {/* ====== MCP Server 管理 ====== */}
        <div className="bg-slate-50 border border-line rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2">🔌 MCP Server</h3>
            <button
              onClick={() => setShowMcpForm(!showMcpForm)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {showMcpForm ? '取消' : '+ 添加'}
            </button>
          </div>

          {showMcpForm && (
            <div className="mb-4 p-3 bg-white rounded-lg border border-line-soft">
              <div className="mb-2">
                <label className={labelClass}>名称</label>
                <input
                  placeholder="如：brave-search"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="mb-2">
                <label className={labelClass}>命令</label>
                <input
                  placeholder="如：npx -y @anthropic/mcp-server-brave-search"
                  value={mcpForm.command}
                  onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="mb-3">
                <label className={labelClass}>参数（空格分隔）</label>
                <input
                  placeholder="可选"
                  value={mcpForm.args}
                  onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })}
                  className={inputClass}
                />
              </div>
              <Button onClick={addMcpServer} disabled={!mcpForm.name || !mcpForm.command}>
                添加
              </Button>
            </div>
          )}

          {mcpServers.length === 0 ? (
            <p className="text-text-muted text-xs">暂无 MCP Server 配置。点击"添加"连接外部工具（如 Brave Search、GitHub 等）。</p>
          ) : (
            <div className="space-y-2">
              {mcpServers.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-line-soft">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.enabled ? 'bg-green-400' : 'bg-gray-300'}`} />
                    <span className="text-[13px] font-medium">{s.name}</span>
                    <span className="text-[11px] text-text-muted">{s.command}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleMcp(s.id, !s.enabled)}
                      className="text-[11px] text-blue-600 hover:text-blue-800"
                    >
                      {s.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => deleteMcp(s.id)}
                      className="text-[11px] text-red-500 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ====== Skill 管理 ====== */}
        <div className="bg-slate-50 border border-line rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2">🧩 Skills</h3>
            <button
              onClick={() => setShowSkillImport(!showSkillImport)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {showSkillImport ? '取消' : '+ 导入'}
            </button>
          </div>

          {showSkillImport && (
            <div className="mb-4 p-3 bg-white rounded-lg border border-line-soft">
              <div className="mb-2">
                <label className={labelClass}>Skill URL</label>
                <input
                  placeholder="粘贴 Claude Code Skill 的 raw URL"
                  value={skillUrl}
                  onChange={(e) => setSkillUrl(e.target.value)}
                  className={inputClass}
                />
                <span className="text-xs text-text-muted mt-1 block">支持 Claude Code 格式的 Skill Markdown 文件</span>
              </div>
              {skillImportMsg && (
                <p className={`text-xs mb-2 ${skillImportMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>
                  {skillImportMsg}
                </p>
              )}
              <Button onClick={importSkill} disabled={skillImporting || !skillUrl.trim()}>
                {skillImporting ? '导入中...' : '导入'}
              </Button>
            </div>
          )}

          {skills.length === 0 ? (
            <p className="text-text-muted text-xs">暂无自定义 Skill。点击"导入"从 URL 添加 Claude Code 社区的 Skill。</p>
          ) : (
            <div className="space-y-2">
              {skills.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-line-soft">
                  <div>
                    <span className="text-[13px] font-medium">{s.name}</span>
                    <span className="text-[11px] text-text-muted ml-2">{s.description}</span>
                  </div>
                  <span className="text-[11px] text-text-muted">
                    {s.workspaceId ? '工作区级' : '用户级'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ContentPageShell>
  );
}
