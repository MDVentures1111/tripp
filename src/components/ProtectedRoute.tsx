"use client";

import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoadingScreen } from './LoadingScreen';
import { RestrictedAccess } from '../pages/RestrictedAccess';
import { DatabaseError } from '../pages/DatabaseError';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { authState, user, apiError } = useAuth();
  const location = useLocation();

  switch (authState) {
    case 'initializing':
    case 'checking':
      return <LoadingScreen message="Verifying organization access…" />;
    case 'unauthenticated':
      return <Navigate to="/auth" replace state={{ from: location }} />;
    case 'restricted':
      return <RestrictedAccess />;
    case 'error':
      return <DatabaseError message={apiError} />;
    case 'authorized':
      return user ? <>{children}</> : <Navigate to="/auth" replace />;
    default:
      return null;
  }
};