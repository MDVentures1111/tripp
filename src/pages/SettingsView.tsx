"use client";

import { useAuth } from '../context/AuthContext';

export const SettingsView: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="view-container">
      <h1 className="view-title">Account & Organization</h1>
      <div className="card">
        <h3>User Profile</h3>
        <dl className="info-grid">
          <dt>Email Address</dt><dd>{user?.email}</dd>
          <dt>Authentication Method</dt><dd>Google OAuth / SSO</dd>
          <dt>Status</dt><dd className="status-active">Authorized</dd>
        </dl>
      </div>
      <div className="card muted">
        <h3>Organization Management</h3>
        <p>Admin controls and billing configurations are accessible to super-admins only.</p>
      </div>
    </div>
  );
};