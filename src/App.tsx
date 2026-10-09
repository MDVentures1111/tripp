"use client";

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { WorkspacePage } from './pages/WorkspacePage';

const AppContent: React.FC = () => {
  const { user } = useAuth();
  
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
      {/* Redirect unknown paths to auth */}
      <Route path="*" element={<Navigate to={user ? "/" : "/auth"} replace />} />
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