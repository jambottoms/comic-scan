import { createBrowserClient } from '@supabase/ssr'

// Singleton pattern - only create client once per browser session
let cachedClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  // Only run on client side - return null during SSR
  if (typeof window === 'undefined') {
    return null;
  }

  // Return cached client if available
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Log warning but don't throw - return null to allow graceful degradation
    console.warn(
      '[Supabase] Missing environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Saved scans feature will be disabled.'
    );
    return null;
  }

  try {
    cachedClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
    return cachedClient;
  } catch (error) {
    console.error('[Supabase] Failed to create client:', error);
    return null;
  }
}

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

