import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        navigate('/');
      } else {
        await register(name, email, password, inviteCode);
        await login(email, password);
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 32, borderRadius: 8, width: 360, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <h1 style={{ textAlign: 'center', marginBottom: 24 }}>CCCLaw</h1>

        {mode === 'register' && (
          <div style={fieldStyle}>
            <label style={labelStyle}>姓名</label>
            <input type="text" placeholder="请输入姓名" value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
          </div>
        )}

        <div style={fieldStyle}>
          <label style={labelStyle}>邮箱</label>
          <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>密码</label>
          <input type="password" placeholder="请输入密码" value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
        </div>

        {mode === 'register' && (
          <div style={fieldStyle}>
            <label style={labelStyle}>邀请码</label>
            <input type="text" placeholder="请输入邀请码" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required style={inputStyle} />
          </div>
        )}

        {error && <p style={{ color: 'red', fontSize: 14 }}>{error}</p>}

        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
        </button>

        <p style={{ textAlign: 'center', fontSize: 14, marginTop: 16 }}>
          {mode === 'login' ? (
            <>还没有账号？<a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); }}>注册</a></>
          ) : (
            <>已有账号？<a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>登录</a></>
          )}
        </p>
      </form>
    </div>
  );
}

const fieldStyle: React.CSSProperties = { marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#333' };
const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 12px',
  border: '1px solid #ddd', borderRadius: 4, fontSize: 14, boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px 0', marginTop: 8,
  background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4,
  fontSize: 16, cursor: 'pointer',
};
