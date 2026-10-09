"use client";

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Navigate } from 'react-router-dom';
import { Google, Loader2 } from 'lucide-react';

export const AuthPage: React.FC = () => {
  const { user, loading, apiError, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect to dashboard if already authenticated
  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const success = await signIn(email, password);
    if (success) {
      navigate('/', { replace: true });
    }
    setIsSubmitting(false);
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    await signInWithGoogle();
  };

  return (
    <div className="page-shell center-content">
      <div className="card wide-card">
        <header className="auth-header">
          <img src="/logo-icon.png" alt="TRIPP Logo" className="auth-logo" />
          <h1>TRIPP Intelligence</h1>
          <p className="muted">Sign in to manage your tenant intelligence.</p>
        </header>

        <div className="auth-forms-container">
          <button 
            type="button" 
            onClick={handleGoogleSignIn}
            disabled={loading || isSubmitting}
            className="btn-google"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Google size={20} />}
            Continue with Google
          </button>

          <div className="divider">
            <span>or continue with email</span>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="input-group">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            
            <div className="input-group">
              <div className="input-label-row">
                <label htmlFor="password">Password</label>
                <button type="button" className="link-button text-sm">Forgot password?</button>
              </div>
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button type="submit" disabled={loading || isSubmitting} className="btn-primary">
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {apiError && <Alert variant="error">{apiError}</Alert>}
      </div>
    </div>
  );
};

const Alert = ({ children, variant }: { children: React.ReactNode; variant: 'error' | 'success' }) => (
  <div className={`alert ${variant === 'error' ? 'alert-error' : 'alert-success'}`}>
    {children}
  </div>
);