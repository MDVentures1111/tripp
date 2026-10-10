"use client";

import React, { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { authState, user, loading } = useAuth();

  // Prevent double-rendering: rely on App.tsx for global loading/error/restricted
  if (loading || authState !== 'authorized' || !user) {
    return null;
  }

  return <>{children}</>;
};