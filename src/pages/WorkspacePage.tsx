"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type Membership = { id: string; user_id: string; organization_id: string; role: string; created_at: string };
type Organization = { id: string; name: string; slug: string; created_at: string };

export const WorkspacePage: React.FC = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  
  // Explicit Authorization State Machine
  const [authz, setAuthz] = useState<'checking' | 'authorized' | 'denied' | 'error'>('checking');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  useEffect(() => {
    let cancelled = false;

    // Reset state machine immediately when the authenticated user changes or app mounts
    setAuthz('checking');
    setMemberships([]);
    setOrganizations([]);

    if (authLoading || !user) {
      return;
    }

    const verifyAccess = async () => {
      try {
        // 1. Verify membership exists for this specific user
        const { data: mems, error: memErr } = await supabase
          .from('organization_memberships')
          .select('*')
          .eq('user_id', user.id);

        if (memErr) throw memErr;
        
        const validMemberships = mems || [];

        // Fail closed: no memberships means unauthorized
        if (validMemberships.length === 0) {
          if (!cancelled) setAuthz('denied');
          return;
        }

        setMemberships(validMemberships);

        // 2. Resolve organization records corresponding to verified memberships
        const orgIds = validMemberships.map(m => m.organization_id);
        
        const { data: orgs, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .in('id', orgIds);

        if (orgErr) throw orgErr;
        
        setOrganizations(orgs || []);
        
        if (!cancelled) setAuthz('authorized');
      } catch (err: any) {
        if (!cancelled) {
          console.error('Organization verification failed:', err.message);
          setAuthz('error');
        }
      }
    };

    verifyAccess();

    // Cancel pending requests on unmount or user change to prevent stale updates
    return () => { cancelled = true; };
  }, [user, authLoading]);

  if (authLoading || authz === 'checking') {
    return (
      <div className="page-shell">
        <div className="loading-state">
          <div className="spinner" />
          <p>Verifying secure access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="shell-header">
        <div className="shell-branding">
          <img src="/logo-icon.png" alt="Logo" className="header-logo" />
          <h2>TRIPP Intelligence — Workspace</h2>
        </div>
        <div className="shell-actions">
          <span className="user-badge">{user?.email}</span>
          <button onClick={() => signOut()} className="btn-secondary">
            Sign Out
          </button>
        </div>
      </header>

      <main className="shell-main">
        {authz === 'error' && (
          <section className="card">
            <h3>System Error</h3>
            <p className="muted">Unable to retrieve organization data due to a connection failure.</p>
          </section>
        )}

        {authz === 'denied' && (
          <section className="card">
            <h3>Access Denied</h3>
            <p className="muted">Your account does not have an active organization membership. Please contact your administrator.</p>
          </section>
        )}

        {authz === 'authorized' && (
          <>
            <section className="card">
              <h3>Authentication Status</h3>
              <dl className="info-grid">
                <dt>Status</dt><dd className="status-active">Authenticated</dd>
                <dt>User ID</dt><dd><code>{user?.id.slice(0, 12)}…{user?.id.slice(-4)}</code></dd>
                <dt>Email</dt><dd>{user?.email}</dd>
              </dl>
            </section>

            <section className="card">
              <h3>Organization Memberships</h3>
              <ul className="membership-list">
                {memberships.map(m => (
                  <li key={m.id} className="membership-item">
                    <span className="role-tag">{m.role.toUpperCase()}</span>
                    <span>Org ID: <code>{m.organization_id.slice(0, 12)}…{m.organization_id.slice(-4)}</code></span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h3>Accessible Organizations</h3>
              {organizations.length === 0 ? (
                <p className="muted">Organization records could not be resolved from IDs.</p>
              ) : (
                <ul className="org-list">
                  {organizations.map(o => (
                    <li key={o.id} className="org-item">
                      <strong>{o.name}</strong>
                      <span>Slug: <code>{o.slug}</code></span>
                      <span>Created: {new Date(o.created_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};