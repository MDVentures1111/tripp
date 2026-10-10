"use client";

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const DatabaseError: React.FC<{ message?: string | null }> = ({ message }) => {
  const { retryAuthorization, signOut, signOutError } = useAuth();

  return (
    <div className="page-shell center-content">
      <div className="card wide-card">
        <div className="text-center mb-4">
          <AlertTriangle size={48} className="text-warning" />
          <h2>Unable to verify access</h2>
          <p className="muted">
            We couldn't confirm your organization membership. This is usually temporary.
          </p>
          {message && <div className="alert alert-error">{message}</div>}
        </div>
        {signOutError && <div className="alert alert-error">Sign out failed: {signOutError}</div>}
        <button onClick={retryAuthorization} className="btn-primary mb-4">Try again</button>
        <button onClick={() => signOut()} className="btn-secondary w-full">Sign out</button>
      </div>
    </div>
  );
};