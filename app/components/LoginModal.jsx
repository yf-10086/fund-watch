'use client';

import Image from 'next/image';
import { useState } from 'react';
import { MailIcon } from './Icons';
import githubImg from '../assets/github.svg';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export default function LoginModal({ onClose, showToast, isExplicitLoginRef, initialError = '' }) {
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(initialError);

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setLoginError('');

    if (!isSupabaseConfigured) {
      showToast('未配置 Supabase，无法登录', 'error');
      return;
    }

    const email = loginEmail.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      setLoginError('请输入邮箱地址');
      return;
    }
    if (!emailRegex.test(email)) {
      setLoginError('请输入有效的邮箱地址');
      return;
    }
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
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="登录" onClick={onClose}>
      <div className="glass card modal login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="title" style={{ marginBottom: 16 }}>
          <MailIcon width="20" height="20" />
          <span>个人账号登录</span>
          <span className="muted">邮箱与密码</span>
        </div>

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

        {process.env.NEXT_PUBLIC_IS_GITHUB_LOGIN === 'true' && (
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
