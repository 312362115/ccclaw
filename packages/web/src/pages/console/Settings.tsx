import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

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
      await api('/settings/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>设置</h2>

      <div style={{ marginBottom: 24 }}>
        <h3>个人信息</h3>
        <p style={{ fontSize: 14, color: '#666' }}>
          {user?.name} / {user?.email} / {user?.role === 'admin' ? '管理员' : '用户'}
        </p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3>模型配置</h3>
        <div style={fieldStyle}>
          <label style={labelStyle}>默认模型</label>
          <input
            placeholder="如：claude-sonnet-4-20250514、gpt-4o、deepseek-chat"
            value={prefs.agentModel ?? ''}
            onChange={(e) => setPrefs({ ...prefs, agentModel: e.target.value || null })}
            style={inputStyle}
          />
          <span style={hintStyle}>留空则使用系统默认模型</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>最大输出 Token</label>
          <input
            type="number"
            placeholder="如：4096"
            value={prefs.maxTokens ?? ''}
            onChange={(e) => setPrefs({ ...prefs, maxTokens: e.target.value ? Number(e.target.value) : null })}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Temperature</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            placeholder="0 ~ 2，默认 1"
            value={prefs.temperature ?? ''}
            onChange={(e) => setPrefs({ ...prefs, temperature: e.target.value ? Number(e.target.value) : null })}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>推理深度</label>
          <select
            value={prefs.reasoningEffort ?? ''}
            onChange={(e) => setPrefs({ ...prefs, reasoningEffort: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">默认</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
          <span style={hintStyle}>仅支持推理模型（如 Claude 3.5+ extended thinking）</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>工具确认模式</label>
          <select
            value={prefs.toolConfirmMode ?? ''}
            onChange={(e) => setPrefs({ ...prefs, toolConfirmMode: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">默认（自动执行）</option>
            <option value="always">每次确认</option>
            <option value="dangerous">仅危险操作确认</option>
          </select>
        </div>
        <button onClick={savePrefs} disabled={saving} style={btnStyle}>
          {saving ? '保存中...' : saved ? '已保存' : '保存配置'}
        </button>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '6px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 };
const fieldStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#333' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 12, color: '#888', marginTop: 2, display: 'block' };
