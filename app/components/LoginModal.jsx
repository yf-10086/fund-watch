'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { MailIcon } from './Icons';
import githubImg from '../assets/github.svg';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginModal({
  onClose,
  showToast,
  isExplicitLoginRef,
  initialError = '',
  initialMode = 'login'
}) {
  const [mode, setMode] = useState(initialMode);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(initialError);
  const [loginSuccess, setLoginSuccess] = useState('');

  useEffect(() => {
    setMode(initialMode);
    setLoginError(initialError);
    setLoginSuccess('');
  }, [initialError, initialMode]);

  const validateEmail = () => {
    const email = loginEmail.trim();
    if (!email) {
      setLoginError('请输入邮箱地址');
      return '';
    }
    if (!EMAIL_REGEX.test(email)) {
      setLoginError('请输入有效的邮箱地址');
      return '';
    }
    return email;
  };

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginSuccess('');

    if (!isSupabaseConfigured) {
      showToast('未配置 Supabase，无法登录', 'error');
      return;
    }

    const email = validateEmail();
    if (!email) return;
    if (!loginPassword) {
      setLoginError('请输入登录密码');
      return;
    }

    try {
      if (isExplicitLoginRef) isExplicitLoginRef.current = true;
      setLoginLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: loginPassword
      });
      if (error) throw error;
      if (data?.user) onClose();
    } catch (err) {
      const message = err.message || '';
      if (message.includes('Invalid login credentials')) {
        setLoginError('邮箱或密码不正确，请检查后重试');
      } else if (message.toLowerCase().includes('network')) {
        setLoginError('网络错误，请检查网络连接');
      } else {
        setLoginError(message || '登录失败，请稍后再试');
      }
      if (isExplicitLoginRef) isExplicitLoginRef.current = false;
    } finally {
      setLoginLoading(false);
    }
  };

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginSuccess('');
    if (!isSupabaseConfigured) {
      setLoginError('未配置 Supabase，无法发送重置邮件');
      return;
    }

    const email = validateEmail();
    if (!email) return;

    try {
      setLoginLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setLoginSuccess('重置邮件已发送。请打开邮箱中的“Reset your password”邮件，并点击重置链接。');
    } catch (err) {
      const message = err.message || '';
      if (message.toLowerCase().includes('rate limit')) {
        setLoginError('发送过于频繁，请至少等待60秒后重试');
      } else if (message.toLowerCase().includes('network')) {
        setLoginError('网络错误，请检查网络连接');
      } else {
        setLoginError(message || '发送失败，请稍后再试');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginSuccess('');
    if (newPassword.length < 8) {
      setLoginError('新密码至少需要8位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLoginError('两次输入的新密码不一致');
      return;
    }

    try {
      setLoginLoading(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      showToast('密码已更新，请保存好新密码', 'success');
      onClose();
    } catch (err) {
      const message = err.message || '';
      if (message.toLowerCase().includes('same password')) {
        setLoginError('新密码不能与旧密码相同');
      } else {
        setLoginError(message || '密码更新失败，请重新打开邮件链接');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGithubLogin = async () => {
    setLoginError('');
    if (!isSupabaseConfigured) {
      showToast('未配置 Supabase，无法登录', 'error');
      return;
    }
    try {
      if (isExplicitLoginRef) isExplicitLoginRef.current = true;
      setLoginLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (err) {
      setLoginError(err.message || 'GitHub 登录失败，请稍后再试');
      if (isExplicitLoginRef) isExplicitLoginRef.current = false;
      setLoginLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'update-password' ? '设置新密码' : mode === 'forgot-password' ? '找回密码' : '登录'}
      onClick={mode === 'update-password' ? undefined : onClose}
    >
      <div className="glass card modal login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="title" style={{ marginBottom: 16 }}>
          <MailIcon width="20" height="20" />
          <span>
            {mode === 'update-password' ? '设置新密码' : mode === 'forgot-password' ? '找回登录密码' : '个人账号登录'}
          </span>
          <span className="muted">
            {mode === 'update-password'
              ? '完成后即可正常登录'
              : mode === 'forgot-password'
                ? '通过邮箱验证'
                : '邮箱与密码'}
          </span>
        </div>

        {mode === 'update-password' ? (
          <form onSubmit={handlePasswordUpdate}>
            <div className="muted" style={{ marginBottom: 16, fontSize: '0.8rem', lineHeight: 1.6 }}>
              身份验证已经完成。请输入两次新密码，不需要输入旧密码。
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <input
                style={{ width: '100%' }}
                className="input"
                type="password"
                name="new-password"
                autoComplete="new-password"
                placeholder="新密码（至少8位）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loginLoading}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <input
                style={{ width: '100%' }}
                className="input"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                placeholder="再次输入新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loginLoading}
              />
            </div>
            {loginError && (
              <div className="login-message error" style={{ marginBottom: 12 }}>
                <span>{loginError}</span>
              </div>
            )}
            <button className="button" type="submit" disabled={loginLoading} style={{ width: '100%' }}>
              {loginLoading ? '正在更新...' : '保存新密码'}
            </button>
          </form>
        ) : mode === 'forgot-password' ? (
          <form onSubmit={handlePasswordResetRequest}>
            <div className="muted" style={{ marginBottom: 16, fontSize: '0.8rem', lineHeight: 1.6 }}>
              输入个人账号邮箱，我们会发送一次性密码重置链接。基金数据和自动分析配置不会改变。
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <input
                style={{ width: '100%' }}
                className="input"
                type="email"
                name="recovery-email"
                autoComplete="email"
                placeholder="邮箱地址"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                disabled={loginLoading || Boolean(loginSuccess)}
              />
            </div>
            {loginError && (
              <div className="login-message error" style={{ marginBottom: 12 }}>
                <span>{loginError}</span>
              </div>
            )}
            {loginSuccess && (
              <div className="login-message success" style={{ marginBottom: 12 }}>
                <span>{loginSuccess}</span>
              </div>
            )}
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setMode('login');
                  setLoginError('');
                  setLoginSuccess('');
                }}
                disabled={loginLoading}
              >
                返回登录
              </button>
              {!loginSuccess && (
                <button className="button" type="submit" disabled={loginLoading}>
                  {loginLoading ? '发送中...' : '发送重置邮件'}
                </button>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={handlePasswordLogin}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <div className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>
                使用在 Supabase 中创建的个人账号登录
              </div>
              <input
                style={{ width: '100%' }}
                className="input"
                type="email"
                name="email"
                autoComplete="username"
                placeholder="邮箱地址"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                disabled={loginLoading}
              />
            </div>

            <button
              type="button"
              className="login-forgot-button"
              onClick={() => {
                setMode('forgot-password');
                setLoginError('');
                setLoginSuccess('');
              }}
              disabled={loginLoading}
            >
              忘记密码？
            </button>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <input
                style={{ width: '100%' }}
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="登录密码"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                disabled={loginLoading}
              />
            </div>

            {loginError && (
              <div className="login-message error" style={{ marginBottom: 12 }}>
                <span>{loginError}</span>
              </div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="button secondary" onClick={onClose} disabled={loginLoading}>
                取消
              </button>
              <button className="button" type="submit" disabled={loginLoading}>
                {loginLoading ? '登录中...' : '登录'}
              </button>
            </div>
          </form>
        )}

        {mode === 'login' && process.env.NEXT_PUBLIC_IS_GITHUB_LOGIN === 'true' && (
          <>
            <div className="login-divider" style={{ display: 'flex', alignItems: 'center', margin: '20px 0', gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span className="muted" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                或使用
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <button
              type="button"
              className="github-login-btn"
              onClick={handleGithubLogin}
              disabled={loginLoading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '12px 16px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                cursor: loginLoading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                opacity: loginLoading ? 0.6 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              <span className="github-icon-wrap">
                <Image
                  unoptimized
                  alt="项目Github地址"
                  src={githubImg}
                  style={{ width: '24px', height: '24px', cursor: 'pointer' }}
                />
              </span>
              <span>使用 GitHub 登录</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
