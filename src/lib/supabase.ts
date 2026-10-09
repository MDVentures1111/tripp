"use client";

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public configuration allowed in browser code
const SUPABASE_URL = 'https://ufcgsdpqfqeifjzzcuei.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_paUz7liH37igNuSi0xeZ5g_Mjke_o41';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);