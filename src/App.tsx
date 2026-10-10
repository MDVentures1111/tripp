"use client";

import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { RestrictedAccess } from './pages/RestrictedAccess';

const AppContent: React.FC = () => {
  const { user, loading, isAuthorized, resolveOrganization } = useAuth();
  
  useEffect(() => {
    if (!loading && user && !isAuthorized) {
      resolveOrganization();
    }
  }, [loading, user, isAuthorized, resolveOrganization]);

  if (loading) {
    return (
      <div className="page-shell center-content">
        <div className="loading-state">
          <div className="spinner" aria-label="Loading" />
          <p>Initializing secure session…</p>
        </div>
      </div>
    );
  }

  if (user && !isAuthorized) {
    return (
      <Routes>
        <Route path="/restricted" element={<RestrictedAccess />} />
        <Route path="*" element={<Navigate to="/restricted" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <WorkspacePage />
          </ProtectedRoute>
        } 
      />
      <Route path="*" element={<Navigate to={isAuthorized ? "/" : "/auth"} replace />} />
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