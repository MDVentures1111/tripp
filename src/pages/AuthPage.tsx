"use client";

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const AuthPage: React.FC = () => {
  const { user, loading, apiError, signIn, signOut } = useAuth();
  const navigate = useNavigate();
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

    const success = await signIn(email, password);

    if (success) {
      setResultMsg('Login successful. Redirecting…');
      navigate('/', { replace: true });
    } else {
      setSubmitting(false);
    }
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
            autoComplete="current-password"
          />

          <button type="submit" disabled={loading || submitting}>
            {submitting ? 'Processing…' : 'Sign In'}
          </button>
        </form>

        {resultMsg && <p className="success-text">{resultMsg}</p>}
        {apiError && <p className="error-text">{apiError}</p>}
      </div>
    </div>
  );
};