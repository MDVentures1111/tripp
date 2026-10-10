"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Outlet, Link, useLocation } from 'react-router-dom';
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

type NavPath =
  | '/workspace'
  | '/workspace/deals'
  | '/workspace/documents'
  | '/workspace/intelligence'
  | '/workspace/settings';

const navItems: { id: NavPath; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: '/workspace', label: 'Executive Overview', icon: LayoutDashboard },
  { id: '/workspace/deals', label: 'Active Deals', icon: Briefcase },
  { id: '/workspace/documents', label: 'Documents', icon: FileText },
  { id: '/workspace/intelligence', label: 'Lease Intelligence', icon: BrainCircuit },
  { id: '/workspace/settings', label: 'Account & Org', icon: Settings },
];

export const WorkspaceLayout: React.FC = () => {
  const { user, signOut, signOutError, resolvedOrgName } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close the mobile menu with Escape
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const handleSignOut = async () => {
    setSigningOut(true);
    const ok = await signOut();
    setSigningOut(false);
    // On failure keep the menu open so the error stays visible and the user can retry
    if (ok) setMobileMenuOpen(false);
  };

  const isActive = (path: NavPath) => {
    const current = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/workspace') return current === '/workspace';
    return current === path || current.startsWith(`${path}/`);
  };

  return (
    <div className="workspace-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="menu-toggle"
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
          aria-controls="workspace-sidebar"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="org-title">{resolvedOrgName || 'TRIPP Intelligence'}</span>
      </header>

      {mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside id="workspace-sidebar" className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <img src="/logo-icon.png" alt="TRIPP Logo" className="sidebar-logo" />
          <h3>TRIPP Intelligence</h3>
          <button
            type="button"
            className="sidebar-close"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={item.id}
              className={`nav-item ${isActive(item.id) ? 'active' : ''}`}
              aria-current={isActive(item.id) ? 'page' : undefined}
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
          {signOutError && <div className="alert alert-error">Sign out failed: {signOutError}</div>}
          <button onClick={handleSignOut} className="signout-btn" disabled={signingOut}>
            <LogOut size={16} /> {signingOut ? 'Signing out…' : signOutError ? 'Retry sign out' : 'Sign Out'}
          </button>
        </div>
      </aside>

      {/* Main Content (nested routes mounted in App.tsx) */}
      <main className="workspace-main">
        <Outlet />
      </main>
    </div>
  );
};