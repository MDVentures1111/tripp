"use client";

import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { resolveOrganization, type OrganizationResolution } from '../lib/organization';
import type { User, Session } from '@supabase/supabase-js';

export type AuthorizationState =
  | 'initializing'
  | 'unauthenticated'
  | 'checking'
  | 'authorized'
  | 'restricted'
  | 'error';

export interface AuthState {
  user: User | null;
  session: Session | null;
  authState: AuthorizationState;
  resolvedOrgId: string | null;
  resolvedOrgName: string | null;
  apiError: string | null;
  signOutError: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<boolean>;
  retryAuthorization: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  authState: 'initializing',
  resolvedOrgId: null,
  resolvedOrgName: null,
  apiError: null,
  signOutError: null,
  signIn: async () => false,
  signInWithGoogle: async () => {},
  signOut: async () => false,
  retryAuthorization: () => {},
});

export const useAuth = () => useContext(AuthContext);

interface Resolution {
  userId: string;
  result: OrganizationResolution;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  
  // Strictly tracks which specific asynchronous authorization check the UI should currently honor.
  // Increments automatically whenever the identity changes or verification is retried.
  const [verificationGeneration, setVerificationGeneration] = useState(0);
  
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  // Single subscription. The callback is synchronous and only records the session;
  // no Supabase calls are made inside it, so it cannot recurse or deadlock.
  // INITIAL_SESSION replaces a separate getSession() call.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Organization resolution is keyed on both the user id and the active verification generation.
  // Cleanup aborts the in-flight request, invalidating stale results.
  useEffect(() => {
    if (!sessionReady) return;

    if (!userId) {
      setResolution(null);
      return;
    }

    const controller = new AbortController();
    
    // Capture the current verification generation to validate the async response later.
    const activeGeneration = verificationGeneration;

    resolveOrganization(userId, controller.signal).then((result) => {
      // Safeguard: only accept this result if it belongs to the most recent verification attempt
      // and hasn't been cancelled by the effect cleanup.
      if (controller.signal.aborted) return;
      if (activeGeneration !== verificationGeneration) return;

      setResolution({ userId, result });
    });

    return () => controller.abort();
  }, [sessionReady, userId, verificationGeneration]);

  // Derived state: a resolution only counts if it was produced for the current user.
  const current = resolution && resolution.userId === userId ? resolution.result : null;

  let authState: AuthorizationState;
  if (!sessionReady) {
    authState = 'initializing';
  } else if (!userId) {
    authState = 'unauthenticated';
  } else {
    authState = current ? current.status : 'checking';
  }

  const resolvedOrgId = current?.status === 'authorized' ? current.orgId : null;
  const resolvedOrgName = current?.status === 'authorized' ? current.orgName : null;
  const apiError = current?.status === 'error' ? current.message : signInError;

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    setSignInError(null);
    setSignOutError(null);
    
    // Advance the verification generation immediately.
    // This ensures that any pending background resolution triggered by a previous session 
    // will fail the generation check and will not overwrite the upcoming verified state.
    setVerificationGeneration((n) => n + 1);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setSignInError(error.message);
      return false;
    }
    // Session change listener drives authorization.
    return true;
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    setSignInError(null);
    setSignOutError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) {
      setSignInError(error.message);
    }
  }, []);

  const signOut = useCallback(async (): Promise<boolean> => {
    setSignOutError(null);
    // Invalidate any ongoing resolution immediately upon sign-out intent.
    setVerificationGeneration((n) => n + 1);
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Session is untouched; surface the failure so the user can retry.
      setSignOutError(error.message);
      return false;
    }
    // The SIGNED_OUT event clears the session and moves state to 'unauthenticated'.
    return true;
  }, []);

  const retryAuthorization = useCallback(() => {
    setSignInError(null);
    // Trigger a fresh validation cycle by bumping the generation counter.
    setVerificationGeneration((n) => n + 1);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        authState,
        apiError,
        signOutError,
        resolvedOrgId,
        resolvedOrgName,
        signIn,
        signInWithGoogle,
        signOut,
        retryAuthorization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};