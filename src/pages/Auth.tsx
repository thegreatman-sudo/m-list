import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Utensils, ArrowRight, ArrowLeft, Mail, Lock, User as UserIcon, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/format';
import { Wordmark } from '@/components/Wordmark';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { signIn, signUp, sendReset } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (resetMode) {
        const { error } = await sendReset(email);
        setLoading(false);
        if (error) setError(error);
        else setInfo('If an account exists for that email, a reset link is on its way.');
        return;
      }
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        setLoading(false);
        if (error) setError(error);
        else navigate(next);
      } else {
        if (restaurantName.trim().length < 2) {
          setError('Please enter your restaurant name.');
          setLoading(false);
          return;
        }
        const { error, needsVerify } = await signUp(email, password, fullName || restaurantName);
        setLoading(false);
        if (error) setError(error);
        else if (needsVerify) {
          setInfo('Check your inbox to verify your email, then log in.');
        } else {
          navigate(next);
        }
      }
    } catch {
      setLoading(false);
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100 flex flex-col">
      <header className="border-b border-ink-700">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
              <Utensils size={18} className="text-white" />
            </div>
            <div className="font-display font-bold"><Wordmark /></div>
          </Link>
          <Link to="/" className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-ink-100">
            <ArrowLeft size={14} /> Back to site
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-7 shadow-card">
            <h1 className="font-display text-2xl font-bold">
              {resetMode ? 'Reset password' : mode === 'login' ? 'Welcome back' : 'Start your free trial'}
            </h1>
            <p className="mt-1.5 text-sm text-ink-400">
              {resetMode
                ? 'Enter your email and we will send you a reset link.'
                : mode === 'login'
                ? 'Log in to your restaurant dashboard.'
                : '14 days free. No card required.'}
            </p>

            <form onSubmit={submit} className="mt-6 space-y-3">
              {mode === 'signup' && !resetMode && (
                <>
                  <Field icon={UserIcon} label="Your name">
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Rani Wijaya"
                      className={inputCls}
                    />
                  </Field>
                  <Field icon={Utensils} label="Restaurant name">
                    <input
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      placeholder="Saffron & Smoke"
                      className={inputCls}
                    />
                  </Field>
                </>
              )}
              <Field icon={Mail} label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@restaurant.com"
                  className={inputCls}
                />
              </Field>
              {!resetMode && (
                <Field icon={Lock} label="Password">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className={inputCls}
                  />
                </Field>
              )}

              {error && <div className="rounded-lg bg-rose2-500/10 border border-rose2-500/30 px-3 py-2 text-sm text-rose2-300">{error}</div>}
              {info && <div className="rounded-lg bg-emerald2-500/10 border border-emerald2-500/30 px-3 py-2 text-sm text-emerald2-300">{info}</div>}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white font-semibold text-sm shadow-glow transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : (
                  <>
                    {resetMode ? 'Send reset link' : mode === 'login' ? 'Log in' : 'Create account'}
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 space-y-2 text-sm">
              {mode === 'login' && (
                <button onClick={() => { setResetMode(!resetMode); setError(null); setInfo(null); }} className="text-saffron-400 hover:text-saffron-300">
                  {resetMode ? 'Back to log in' : 'Forgot password?'}
                </button>
              )}
              <div className="text-ink-400">
                {mode === 'login' ? (
                  <>No account yet? <Link to="/signup" className="text-saffron-400 hover:text-saffron-300">Start a free trial</Link></>
                ) : (
                  <>Already have an account? <Link to="/login" className="text-saffron-400 hover:text-saffron-300">Log in</Link></>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full h-11 rounded-xl bg-ink-900 border border-ink-600 px-3 text-sm focus:border-saffron-500 focus:outline-none transition-colors';

function Field({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-400 mb-1.5">{label}</span>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
        <div className={cn('[&>input]:pl-9')}>{children}</div>
      </div>
    </label>
  );
}
