"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  apiError: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  apiError: null,
  signIn: async () => false,
  signUp: async () => false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const updateSession = useCallback((sess: Session | null) => {
    setSession(sess);
    setUser(sess?.user ?? null);
    setLoading(false);
    setApiError(null);
  }, []);

  // Initialize session on mount (survives refresh)
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        updateSession(data.session);
      } catch (err: any) {
        console.error('Auth initialization failed:', err.message);
        setApiError(err.message || 'Failed to initialize authentication.');
        setLoading(false);
      }
    };
    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      updateSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, [updateSession]);

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

  const signUp = async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setApiError(null);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setApiError(error.message);
        setLoading(false);
        return false;
      }
      return true;
    } catch (err: any) {
      setApiError(err.message || 'Unexpected error during sign up.');
      setLoading(false);
      return false;
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      updateSession(null);
    } catch (err: any) {
      setApiError(err.message || 'Failed to sign out.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, apiError, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};