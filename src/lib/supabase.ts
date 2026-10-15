"use client";

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** No implicit production fallback. Production must be explicitly configured at deployment. */
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const environment = (import.meta.env.VITE_APP_ENV ?? 'development').trim();
const PRODUCTION_PROJECT_REF = 'ufcgsdpqfqeifjzzcuei';

if (!url || !key) {
  throw new Error('Supabase environment is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}
let projectRef: string;
try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/^([a-z0-9-]+)\.supabase\.co$/.test(parsed.hostname)) {
    throw new Error('Invalid Supabase URL');
  }
  projectRef = parsed.hostname.split('.')[0];
} catch {
  throw new Error('Invalid VITE_SUPABASE_URL. Expected an HTTPS Supabase project URL.');
}
if (environment !== 'production' && projectRef === PRODUCTION_PROJECT_REF) {
  throw new Error('Safety block: non-production frontend cannot connect to production Supabase.');
}
if (environment === 'production' && projectRef !== PRODUCTION_PROJECT_REF) {
  throw new Error('Safety block: production environment points to an unexpected Supabase project.');
}

export const supabaseUrl = url;
export const supabasePublishableKey = key;
export const supabase: SupabaseClient = createClient(url, key);
