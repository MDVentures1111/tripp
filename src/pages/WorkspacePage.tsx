"use client";

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  LayoutDashboard, 
  FileText, 
  Briefcase, 
  BrainCircuit, 
  Settings, 
  LogOut, 
  Menu, 
  X 
} from 'lucide-react';

type View = 'home' | 'deals' | 'documents' | 'intelligence' | 'settings';

export const WorkspacePage: React.FC = () => {
  const { user, signOut, resolvedOrgName } = useAuth();
  const [activeView, setActiveView] = useState<View>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { id: View; label: string; icon: any }[] = [
    { id: 'home', label: 'Executive Overview', icon: LayoutDashboard },
    { id: 'deals', label: 'Active Deals', icon: Briefcase },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'intelligence', label: 'Lease Intelligence', icon: BrainCircuit },
    { id: 'settings', label: 'Account & Org', icon: Settings },
  ];

  const handleSignOut = async () => {
    setMobileMenuOpen(false);
    await signOut();
  };

  const renderContent = () => {
    switch(activeView) {
      case 'home':
        return <HomeView userName={user?.email} orgName={resolvedOrgName} />;
      case 'deals':
        return <EmptyView title="Active Deals" subtitle="No active deal pipelines are currently tracked for this organization." icon={Briefcase} />;
      case 'documents':
        return <EmptyView title="Documents" subtitle="Proposal and document management will appear here once initialized." icon={FileText} />;
      case 'intelligence':
        return <EmptyView title="Lease Intelligence" subtitle="AI-powered lease analysis and advisory capabilities are forthcoming." icon={BrainCircuit} />;
      case 'settings':
        return <SettingsView userEmail={user?.email ?? ''} />;
      default:
        return null;
    }
  };

  return (
    <div className="workspace-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="menu-toggle" aria-label="Toggle menu">
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="org-title">{resolvedOrgName || 'TRIPP Intelligence'}</span>
      </header>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <img src="/logo-icon.png" alt="TRIPP Logo" className="sidebar-logo" />
          <h3>TRIPP Intelligence</h3>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? 'active' : ''}`}
              onClick={() => { setActiveView(item.id); setMobileMenuOpen(false); }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-email">{user?.email}</span>
          </div>
          <button onClick={handleSignOut} className="signout-btn">
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="workspace-main">
        {renderContent()}
      </main>
    </div>
  );
};

const HomeView = ({ userName, orgName }: { userName?: string; orgName?: string }) => (
  <div className="view-container">
    <h1 className="view-title">Executive Overview</h1>
    <p className="view-subtitle">Welcome to {orgName || 'TRIPP Intelligence'}, {userName?.split('@')[0]}.</p>
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

const EmptyView = ({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: any }) => (
  <div className="view-container">
    <div className="empty-state">
      <Icon size={48} className="empty-icon" />
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  </div>
);

const SettingsView = ({ userEmail }: { userEmail: string }) => (
  <div className="view-container">
    <h1 className="view-title">Account & Organization</h1>
    <div className="card">
      <h3>User Profile</h3>
      <dl className="info-grid">
        <dt>Email Address</dt><dd>{userEmail}</dd>
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