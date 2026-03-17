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

const inputClass = 'block w-full px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10';
const labelClass = 'block mb-1 text-[13px] font-medium text-text-primary';

export function Settings() {
  const user = useAuthStore((s) => s.user);
  const [prefs, setPrefs] = useState<Preferences>(defaultPrefs);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Preferences>('/settings/preferences').then((data) => {
      setPrefs({ ...defaultPrefs, ...data });
    }).catch(() => {});
  }, []);

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
      </div>
    </ContentPageShell>
  );
}
