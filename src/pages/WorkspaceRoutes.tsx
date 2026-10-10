"use client";

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { HomeView } from './HomeView';
import { DealsView } from './DealsView';
import { DocumentsView } from './DocumentsView';
import { IntelligenceView } from './IntelligenceView';
import { SettingsView } from './SettingsView';

// Temporary placeholder deal workspace until backend is built
export const DealWorkspace: React.FC = () => {
  return (
    <div className="view-container">
      <h1 className="view-title">Deal Workspace</h1>
      <p className="muted">Deal workspace engine is currently being initialized.</p>
    </div>
  );
};

export const WorkspaceRoutes: React.FC = () => {
  return (
    <Routes>
      <Route index element={<HomeView />} />
      <Route path="deals" element={<DealsView />} />
      <Route path="deals/:id" element={<DealWorkspace />} />
      <Route path="documents" element={<DocumentsView />} />
      <Route path="intelligence" element={<IntelligenceView />} />
      <Route path="settings" element={<SettingsView />} />
      <Route path="*" element={<Navigate to="/workspace" replace />} />
    </Routes>
  );
};