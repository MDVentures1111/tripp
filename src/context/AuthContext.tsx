"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface OrganizationRecord { id: string; name: string; slug: string; created_at: string }

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  apiError: string | null;
  resolvedOrgId: string | null;
  resolvedOrgName: string | null;
  isAuthorized: boolean;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signOut: () => Promise<void>;
  resolveOrganization: () => Promise<boolean>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  apiError: null,
  resolvedOrgId: null,
  resolvedOrgName: null,
  isAuthorized: false,
  signIn: async () => false,
  signInWithGoogle: async () => false,
  signOut: async () => {},
  resolveOrganization: async () => false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(null);
  const [resolvedOrgName, setResolvedOrgName] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const updateSession = useCallback((sess: Session | null) => {
    setSession(sess);
    setUser(sess?.user ?? null);
    setResolvedOrgId(null);
    setResolvedOrgName(null);
    setIsAuthorized(!!sess);
    setLoading(false);
    setApiError(null);
  }, []);

  // Initialize session on mount (survives refresh)
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('Auth initialization failed:', error.message);
        setApiError(error.message);
      }
      updateSession(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      updateSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, [updateSession]);

  const resolveOrganization = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const { data: mems, error: memErr } = await supabase
        .from('organization_memberships')
        .select('*')
        .eq('user_id', user.id);

      if (memErr) throw memErr;
      if (!mems || mems.length === 0) {
        setIsAuthorized(false);
        return false;
      }

      const orgIds = mems.map(m => m.organization_id);

      const { data: orgs, error: orgErr } = await supabase
        .from('organizations')
        .select('*')
        .in('id', orgIds);

      if (orgErr) throw orgErr;

      const primaryOrg = orgs && orgs.length > 0 ? orgs[0] : null;
      setResolvedOrgId(primaryOrg?.id ?? null);
      setResolvedOrgName(primaryOrg?.name ?? null);
      setIsAuthorized(true);
      return true;
    } catch (err: any) {
      console.error('Organization resolution failed:', err.message);
      setApiError(err.message);
      return false;
    }
  }, [user]);

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setApiError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setApiError(error.message);
        setLoading(false);
        return false;
      }
      return true;
    } catch (err: any) {
      setApiError(err.message || 'Unexpected error during sign in.');
      setLoading(false);
      return false;
    }
  };

  const signInWithGoogle = async (): Promise<boolean> => {
    setLoading(true);
    setApiError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });
      if (error) {
        setApiError(error.message);
        setLoading(false);
        return false;
      }
      return true;
    } catch (err: any) {
      setApiError(err.message || 'Unexpected error during Google sign-in.');
      setLoading(false);
      return false;
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      updateSession(null);
    } catch (err: any) {
      setApiError(err.message || 'Failed to sign out.');
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      apiError, 
      resolvedOrgId, 
      resolvedOrgName, 
      isAuthorized,
      signIn, 
      signInWithGoogle, 
      signOut,
      resolveOrganization 
    }}>
      {children}
    </AuthContext.Provider>
  );
};