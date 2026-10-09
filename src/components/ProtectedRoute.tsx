"use client";

import React, { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <div className="page-shell">
        <div className="loading-state">
          <div className="spinner" />
          <p>Verifying secure session…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
};