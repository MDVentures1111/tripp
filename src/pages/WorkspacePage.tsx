"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Database } from '../../types/database.types'; // We'll infer types loosely below
import type { Tables } from '@supabase/supabase-js';

type Membership = { id: string; user_id: string; organization_id: string; role: string; created_at: string };
type Organization = { id: string; name: string; slug: string; created_at: string };

export const WorkspacePage: React.FC = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchOrgData = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1. Fetch memberships for this user
        const { data: mems, error: memErr } = await supabase
          .from('organization_memberships')
          .select('*')
          .eq('user_id', user.id);

        if (memErr) throw memErr;
        if (!cancelled) setMemberships(mems || []);

        // 2. Fetch organizations they belong to
        const orgIds = (mems || []).map(m => m.organization_id);
        if (orgIds.length > 0) {
          const { data: orgs, error: orgErr } = await supabase
            .from('organizations')
            .select('*')
            .in('id', orgIds);

          if (orgErr) throw orgErr;
          if (!cancelled) setOrganizations(orgs || []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load organization data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrgData();
    return () => { cancelled = true; };
  }, [user]);

  if (authLoading || loading) {
    return (
      <div className="page-shell">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading workspace…</p>
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
          <span className="user-badge">
            {user?.email}
          </span>
          <button onClick={() => signOut()} className="btn-secondary">
            Sign Out
          </button>
        </div>
      </header>

      <main className="shell-main">
        {error && <div className="alert alert-error">{error}</div>}

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
          {memberships.length === 0 ? (
            <p className="muted">No active organization memberships found. Contact your administrator.</p>
          ) : (
            <ul className="membership-list">
              {memberships.map(m => (
                <li key={m.id} className="membership-item">
                  <span className="role-tag">{m.role.toUpperCase()}</span>
                  <span>Org ID: <code>{m.organization_id.slice(0, 12)}…{m.organization_id.slice(-4)}</code></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Accessible Organizations</h3>
          {organizations.length === 0 ? (
            <p className="muted">No organizations returned by Supabase query.</p>
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
      </main>
    </div>
  );
};