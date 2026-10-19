import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, StaffRole, Tenant } from '@/types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  tenant: Tenant | null;
  /** Role shortcut. null when logged out. */
  role: StaffRole | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null; needsVerify: boolean }>;
  signOut: () => Promise<void>;
  sendReset: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const GENERIC = 'Something went wrong. Please try again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, tenant:tenants(*)')
      .eq('id', userId)
      .maybeSingle();
    if (error) console.error('profile load failed:', error.message);
    if (data) {
      const row = data as unknown as Profile & { tenant: Tenant | null };
      setProfile(row);
      setTenant(row.tenant ?? null);
    } else {
      setProfile(null);
      setTenant(null);
    }
    // Always clear the gate — a failed lookup must never hang the app on a blank screen.
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s?.user) {
        // The callback runs synchronously inside Supabase's event loop; awaiting
        // a Supabase query here directly deadlocks (blank page after login).
        (async () => { await loadProfile(s.user!.id); })();
      } else {
        setProfile(null);
        setTenant(null);
        setLoading(false);
      }
      if (event === 'SIGNED_OUT') setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // loading flips false once a session's profile resolution finished
  useEffect(() => {
    if (session && profile) setLoading(false);
  }, [session, profile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    return { error: error ? (error.message.includes('Invalid login') ? 'Wrong email or password.' : error.message.includes('Email not confirmed') ? 'Please verify your email first — check your inbox.' : GENERIC) : null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    if (error) {
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        return { error: 'An account with that email already exists. Try logging in.', needsVerify: false };
      }
      return { error: error.message.includes('Password') ? 'Password must be at least 6 characters.' : GENERIC, needsVerify: false };
    }
    return { error: null, needsVerify: !data.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setTenant(null);
  };

  const sendReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    // Neutral outcome whether or not the account exists.
    return { error: error ? GENERIC : null };
  };

  const role = (profile?.role ?? null) as StaffRole | null;

  return (
    <AuthContext.Provider
      value={{ loading, session, user: session?.user ?? null, profile, tenant, role, signIn, signUp, signOut, sendReset, refreshProfile: () => session ? loadProfile(session.user.id) : Promise.resolve() }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
