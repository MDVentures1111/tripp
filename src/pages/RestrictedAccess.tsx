"use client";

import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle } from 'lucide-react';

export const RestrictedAccess: React.FC = () => {
  const { signOut } = useAuth();

  return (
    <div className="page-shell center-content">
      <div className="card wide-card">
        <div className="text-center mb-4">
          <AlertTriangle size={48} className="text-warning mx-auto mb-2" />
          <h2>Access Restricted</h2>
          <p className="muted">Your account does not have an active organization membership. Please contact your administrator.</p>
        </div>
        <button onClick={() => signOut()} className="btn-secondary w-full">Return to Sign In</button>
      </div>
    </div>
  );
};