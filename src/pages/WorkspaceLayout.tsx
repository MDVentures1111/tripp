"use client";

import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
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

type ViewPath = '/workspace' | '/workspace/deals' | '/workspace/deals/:id' | '/workspace/documents' | '/workspace/intelligence' | '/workspace/settings';

export const WorkspaceLayout: React.FC = () => {
  const { user, signOut, resolvedOrgName } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const location = useLocation();

  const navItems: { id: ViewPath; label: string; icon: any; exact?: boolean }[] = [
    { id: '/workspace', label: 'Executive Overview', icon: LayoutDashboard },
    { id: '/workspace/deals', label: 'Active Deals', icon: Briefcase },
    { id: '/workspace/documents', label: 'Documents', icon: FileText },
    { id: '/workspace/intelligence', label: 'Lease Intelligence', icon: BrainCircuit },
    { id: '/workspace/settings', label: 'Account & Org', icon: Settings },
  ];

  const handleSignOut = async () => {
    setMobileMenuOpen(false);
    await signOut();
  };

  const isActive = (path: ViewPath) => {
    if (path.endsWith('/:id')) {
      return location.pathname.startsWith('/workspace/deals');
    }
    return location.pathname === path;
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
            <Link
              key={item.id}
              to={item.id}
              className={`nav-item ${isActive(item.id) ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </Link>
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

      {/* Main Content (Nested Routes) */}
      <main className="workspace-main">
        <Outlet />
      </main>
    </div>
  );
};