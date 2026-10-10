"use client";

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { WorkspaceLayout } from './pages/WorkspaceLayout';
import { RestrictedAccess } from './pages/RestrictedAccess';
import { DatabaseError } from './pages/DatabaseError';

const AppContent: React.FC = () => {
  const { user, authState, apiError } = useAuth();

  // Loading Phase: Initializing or actively resolving org membership
  if (authState === 'initializing' || authState === 'checking') {
    return (
      <div className="page-shell center-content">
        <div className="loading-state">
          <div className="spinner" aria-label="Loading" />
          <p>Establishing secure session…</p>
        </div>
      </div>
    );
  }

  // Error Phase: Database failures during authorization
  if (authState === 'error') {
    return (
      <Routes>
        <Route path="/database-error" element={<DatabaseError message={apiError} />} />
        <Route path="*" element={<Navigate to="/database-error" replace />} />
      </Routes>
    );
  }

  // Restricted Phase: Authenticated but lacking valid org membership
  if (authState === 'restricted') {
    return <RestrictedAccess />;
  }

  // Authorized Phase: Valid session + verified organization membership
  return (
    <Routes>
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <WorkspaceLayout />
          </ProtectedRoute>
        } 
      />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;