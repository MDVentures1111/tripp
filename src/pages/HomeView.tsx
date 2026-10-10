"use client";

import React from 'react';
import { useAuth } from '../context/AuthContext';

export const HomeView: React.FC = () => {
  const { user, resolvedOrgName } = useAuth();
  
  return (
    <div className="view-container">
      <h1 className="view-title">Executive Overview</h1>
      <p className="view-subtitle">Welcome to {resolvedOrgName || 'TRIPP Intelligence'}, {user?.email?.split('@')[0]}.</p>
      <div className="dashboard-grid">
        <div className="stat-card">
          <h3>Portfolio Size</h3>
          <p className="stat-value">—</p>
          <p className="stat-caption">Total square footage pending analysis</p>
        </div>
        <div className="stat-card">
          <h3>Active Leases</h3>
          <p className="stat-value">—</p>
          <p className="stat-caption">Contracts under review or active</p>
        </div>
        <div className="stat-card">
          <h3>Upcoming Expirations</h3>
          <p className="stat-value">—</p>
          <p className="stat-caption">Critical decision points requiring action</p>
        </div>
        <div className="stat-card highlight">
          <h3>Intelligence Score</h3>
          <p className="stat-value">—</p>
          <p className="stat-caption">Aggregate risk & opportunity indicator</p>
        </div>
      </div>
    </div>
  );
};

export const EmptyView: React.FC<{ title: string; subtitle: string; icon: any }> = ({ title, subtitle, icon: Icon }) => (
  <div className="view-container">
    <div className="empty-state">
      <Icon size={48} className="empty-icon" />
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  </div>
);