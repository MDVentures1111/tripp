"use client";

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

type Mode = 'signin' | 'signup';

export const AuthPage: React.FC = () => {
  const { user, loading, apiError, signIn, signUp, signOut } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  // Redirect to dashboard if already authenticated
  if (user) {
    return (
      <div className="page-shell">
        <div className="card">
          <h2>Already Signed In</h2>
          <p>User: {user.email}</p>
          <button onClick={() => { signOut(); navigate('/auth'); }}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResultMsg(null);

    let success = false;
    if (mode === 'signin') {
      success = await signIn(email, password);
    } else {
      success = await signUp(email, password);
    }

    if (success) {
      setResultMsg(mode === 'signin' ? 'Login successful.' : 'Account created. Check your email for confirmation if required.');
    }
    setSubmitting(false);
  };

  return (
    <div className="page-shell center-content">
      <div className="card wide-card">
        <header className="auth-header">
          <img src="/logo-icon.png" alt="TRIPP Logo" className="auth-logo" />
          <h1>TRIPP Intelligence</h1>
        </header>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />

          <button type="submit" disabled={loading || submitting}>
            {submitting ? 'Processing…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-switcher">
          <button type="button" onClick={() => setMode('signin')} disabled={loading || submitting}>
            Sign In
          </button>
          <button type="button" onClick={() => setMode('signup')} disabled={loading || submitting}>
            Sign Up
          </button>
        </div>

        {resultMsg && <p className="success-text">{resultMsg}</p>}
        {apiError && <p className="error-text">{apiError}</p>}
      </div>
    </div>
  );
};