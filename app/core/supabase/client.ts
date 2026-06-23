// Supabase client — the ONLY place @supabase/supabase-js is constructed. Ships the ANON key only
// (M1B §2 / hardening A3/S1): the service_role key is never bundled. The bootstrap function is
// service_role-only and is therefore unreachable from this client by construction.
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Persist the session (offline session lifecycle — M1B S2) and auto-refresh when online.
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', anonKey ?? 'anon-placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
