"use client";

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoadingScreen } from './components/LoadingScreen';
import { AuthPage } from './pages/AuthPage';
import { WorkspaceLayout } from './pages/WorkspaceLayout';
import { HomeView } from './pages/HomeView';
import { DealsView } from './pages/DealsView';
import { DealWorkspace } from './pages/DealWorkspace';
import { DocumentsView } from './pages/DocumentsView';
import { IntelligenceView } from './pages/IntelligenceView';
import { SettingsView } from './pages/SettingsView';

const AppContent: React.FC = () => {
  const { authState } = useAuth();

  // Wait for the first auth event so OAuth redirects are processed before any route redirect runs.
  if (authState === 'initializing') {
    return <LoadingScreen message="Establishing secure session…" />;
  }

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/workspace"
        element={
          <ProtectedRoute>
            <WorkspaceLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeView />} />
        <Route path="deals" element={<DealsView />} />
        <Route path="deals/:id" element={<DealWorkspace />} />
        <Route path="documents" element={<DocumentsView />} />
        <Route path="intelligence" element={<IntelligenceView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Route>
      <Route path="/" element={<Navigate to="/workspace" replace />} />
      <Route path="*" element={<Navigate to="/workspace" replace />} />
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