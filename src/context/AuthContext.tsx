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
  generation: number;
  result: OrganizationResolution;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  
  // Tracks the version of the verification cycle currently in flight.
  const [verificationGeneration, setVerificationGeneration] = useState(0);
  
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Runs when session is ready, user identity shifts, or a manual retry/new login occurs.
  useEffect(() => {
    if (!sessionReady) return;

    if (!userId) {
      setResolution(null);
      return;
    }

    // Capture a snapshot of the generation ID associated strictly with this effect instance.
    const requestGeneration = verificationGeneration;

    const controller = new AbortController();

    resolveOrganization(userId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      
      // Strict Validation: prevents older responses from overwriting a newly started verification lifecycle.
      if (requestGeneration !== verificationGeneration) return;

      setResolution({ userId, generation: requestGeneration, result });
    }).catch((err) => {
      if (controller.signal.aborted) return;
      if (requestGeneration !== verificationGeneration) return;

      // Treat unexpected rejections (network drops, signal overrides) as recoverable error states.
      const message = err instanceof Error ? err.message : 'Network verification failed.';
      setResolution({ userId, generation: requestGeneration, result: { status: 'error', message } });
    });

    return () => controller.abort();
  }, [sessionReady, userId, verificationGeneration]);

  // Derived state strictly validates identity AND generation match before exposing authorization to the UI.
  const current = resolution && resolution.userId === userId && resolution.generation === verificationGeneration
    ? resolution.result
    : null;

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
    
    // Advance generation before initiating authentication to instantly invalidate prior checks.
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
      setSignOutError(error.message);
      return false;
    }
    return true;
  }, []);

  const retryAuthorization = useCallback(() => {
    setSignInError(null);
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