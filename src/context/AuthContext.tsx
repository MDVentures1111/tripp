"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

// Explicit authorization lifecycle states
export type AuthorizationState = 'initializing' | 'checking' | 'authorized' | 'restricted' | 'error';

interface OrganizationRecord { id: string; name: string; slug: string; created_at: string }

export interface AuthState {
  user: User | null;
  session: Session | null;
  authState: AuthorizationState;
  resolvedOrgId: string | null;
  resolvedOrgName: string | null;
  apiError: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  authState: 'initializing',
  resolvedOrgId: null,
  resolvedOrgName: null,
  apiError: null,
  signIn: async () => false,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authState, setAuthState] = useState<AuthorizationState>('initializing');
  const [apiError, setApiError] = useState<string | null>(null);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(null);
  const [resolvedOrgName, setResolvedOrgName] = useState<string | null>(null);

  // Stable reference to the latest abort controller for cancellation safety
  const abortRef = useRef<AbortController | null>(null);

  // Initialize session on mount (survives refresh)
  useEffect(() => {
    const loadInitialSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        
        // Trigger organization check immediately if a session exists
        if (data.session) {
          await startOrganizationResolution();
        } else {
          setAuthState('initializing');
        }
      } catch (err: any) {
        console.error('Auth initialization failed:', err.message);
        setApiError(err.message);
        setAuthState('error');
      }
    };

    loadInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      // Invalidate previous organization context immediately upon session change
      setResolvedOrgId(null);
      setResolvedOrgName(null);
      setApiError(null);

      if (newSession) {
        startOrganizationResolution();
      } else {
        setAuthState('initializing');
      }
    });

    return () => {
      subscription.unsubscribe();
      // Cancel any in-flight resolution on cleanup
      abortRef.current?.abort();
    };
  }, []);

  const startOrganizationResolution = useCallback(async () => {
    // Abort any pending resolution request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Ensure we have a user before proceeding
    if (!user) return;

    setAuthState('checking');

    try {
      // 1. Verify active memberships
      const { data: mems, error: memErr } = await supabase
        .from('organization_memberships')
        .select('*')
        .eq('user_id', user.id);

      if (controller.signal.aborted || memErr) {
        if (memErr && !controller.signal.aborted) {
          setApiError(memErr.message);
          setAuthState('error');
        }
        return;
      }

      if (!mems || mems.length === 0) {
        setAuthState('restricted');
        return;
      }

      // 2. Fetch associated organizations
      const orgIds = mems.map(m => m.organization_id);
      const { data: orgs, error: orgErr } = await supabase
        .from('organizations')
        .select('*')
        .in('id', orgIds);

      if (controller.signal.aborted) return;

      if (orgErr) {
        setApiError(orgErr.message);
        setAuthState('error');
        return;
      }

      if (!orgs || orgs.length === 0) {
        setAuthState('restricted');
        return;
      }

      // Success state: authorized with primary organization context
      const primaryOrg = orgs[0];
      setResolvedOrgId(primaryOrg.id);
      setResolvedOrgName(primaryOrg.name);
      setAuthState('authorized');
    } catch (err: any) {
      if (!controller.signal.aborted) {
        console.error('Organization resolution failed:', err.message);
        setApiError(err.message);
        setAuthState('error');
      }
    }
  }, [user]);

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setAuthState('checking');
    setApiError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setApiError(error.message);
        setAuthState('initializing');
        return false;
      }
      // On success, session change listener triggers resolution automatically
      return true;
    } catch (err: any) {
      setApiError(err.message || 'Unexpected error during sign in.');
      setAuthState('error');
      return false;
    }
  };

  const signInWithGoogle = async (): Promise<void> => {
    setAuthState('checking');
    setApiError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });
      if (error) {
        setApiError(error.message);
        setAuthState('initializing');
      }
    } catch (err: any) {
      setApiError(err.message || 'Unexpected error during Google sign-in.');
      setAuthState('error');
    }
  };

  const signOut = async (): Promise<void> => {
    abortRef.current?.abort();
    setAuthState('initializing');
    setResolvedOrgId(null);
    setResolvedOrgName(null);
    setApiError(null);

    try {
      await supabase.auth.signOut();
    } catch (err: any) {
      console.error('Sign out failed:', err.message);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      authState, 
      apiError, 
      resolvedOrgId, 
      resolvedOrgName,
      signIn, 
      signInWithGoogle, 
      signOut 
    }}>
      {children}
    </AuthContext.Provider>
  );
};