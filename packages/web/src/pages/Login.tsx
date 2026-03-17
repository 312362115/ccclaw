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

  const inputClass = 'block w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white shadow-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200 placeholder:text-slate-400';

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-blue-500/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-indigo-500/5 blur-3xl" />
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative bg-white/80 backdrop-blur-xl border border-slate-200/60 shadow-xl rounded-3xl px-10 py-10 w-[420px] max-w-[90vw]"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-white font-extrabold text-lg"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              boxShadow: '0 8px 24px rgba(37, 99, 235, 0.3)',
            }}
          >
            CC
          </div>
          <h1 className="text-2xl font-bold text-text-primary">CC Claw</h1>
          <p className="text-sm text-text-muted mt-1">
            {mode === 'login' ? '登录即用的云端 AI 工作台' : '创建新账户'}
          </p>
        </div>

        {mode === 'register' && (
          <div className="mb-4">
            <label className="block mb-1.5 text-[13px] font-medium text-text-primary">姓名</label>
            <input type="text" placeholder="请输入姓名" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>
        )}

        <div className="mb-5">
          <label className="block mb-1.5 text-[13px] font-medium text-text-primary">邮箱</label>
          <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
        </div>

        <div className="mb-5">
          <label className="block mb-1.5 text-[13px] font-medium text-text-primary">密码</label>
          <input type="password" placeholder="请输入密码" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputClass} />
        </div>

        {mode === 'register' && (
          <div className="mb-4">
            <label className="block mb-1.5 text-[13px] font-medium text-text-primary">邀请码</label>
            <input type="text" placeholder="请输入邀请码" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required className={inputClass} />
          </div>
        )}

        {error && (
          <div className="mb-4 text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="block w-full py-3 mt-3 rounded-xl text-white font-semibold text-base transition-all duration-200 shadow-[0_4px_16px_rgba(37,99,235,0.3)] hover:shadow-[0_8px_24px_rgba(37,99,235,0.4)] hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
        >
          {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
        </button>

        <p className="text-center text-sm mt-5 text-text-muted">
          {mode === 'login' ? (
            <>还没有账号？<button type="button" onClick={() => setMode('register')} className="text-accent font-medium hover:underline">注册</button></>
          ) : (
            <>已有账号？<button type="button" onClick={() => setMode('login')} className="text-accent font-medium hover:underline">登录</button></>
          )}
        </p>
      </form>
    </div>
  );
}
