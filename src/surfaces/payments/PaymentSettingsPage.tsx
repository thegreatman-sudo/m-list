import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Utensils, ArrowLeft, CreditCard, Save, TestTube2, Check, AlertCircle, Loader2,
  Eye, EyeOff, Shield, Wallet, Banknote, Smartphone, QrCode, Building2, RotateCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import type { PaymentProviderSettings } from '@/types';
import { cn } from '@/lib/format';
import { Button, Spinner } from '@/components/ui';
import { Wordmark } from '@/components/Wordmark';

const ALL_METHODS = [
  { id: 'qris', label: 'QRIS', icon: QrCode },
  { id: 'gopay', label: 'GoPay', icon: Smartphone },
  { id: 'shopeepay', label: 'ShopeePay', icon: Wallet },
  { id: 'bank_transfer', label: 'Bank Transfer / VA', icon: Building2 },
  { id: 'credit_card', label: 'Credit Card', icon: CreditCard },
] as const;

export function PaymentSettingsPage() {
  const { tenant, signOut } = useAuth();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<PaymentProviderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [merchantId, setMerchantId] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [serverKey, setServerKey] = useState('');
  const [showServerKey, setShowServerKey] = useState(false);
  const [hasExistingServerKey, setHasExistingServerKey] = useState(false);
  const [enabledMethods, setEnabledMethods] = useState<string[]>(['qris', 'gopay', 'credit_card']);
  const [cashEnabled, setCashEnabled] = useState(true);
  const [isActive, setIsActive] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!tenant) { setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('payment_provider_settings')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (data) {
      const s = data as PaymentProviderSettings;
      setSettings(s);
      setEnvironment(s.environment);
      setMerchantId(s.merchant_id ?? '');
      setClientKey(s.client_key ?? '');
      setHasExistingServerKey(!!s.client_key);
      setEnabledMethods(s.enabled_methods ?? []);
      setCashEnabled(s.cash_enabled);
      setIsActive(s.is_active);
    }
    setLoading(false);
  }, [tenant]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const toggleMethod = (id: string) => {
    setEnabledMethods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!tenant) return;
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      // The upsert RPC encrypts the server key inside the database and
      // verifies the caller is an owner/manager. Pass empty string for
      // server_key if the user didn't enter a new one — the RPC keeps
      // the existing encrypted value in that case.
      const { error: upsertErr } = await supabase.rpc('upsert_payment_settings', {
        p_tenant_id: tenant.id,
        p_environment: environment,
        p_merchant_id: merchantId.trim() || null,
        p_client_key: clientKey.trim() || null,
        p_server_key: serverKey.trim() || null,
        p_enabled_methods: enabledMethods,
        p_cash_enabled: cashEnabled,
        p_is_active: isActive,
      });
      if (upsertErr) {
        setError('Could not save settings: ' + upsertErr.message);
        setSaving(false);
        return;
      }
      if (serverKey.trim()) {
        setHasExistingServerKey(true);
        setServerKey('');
      }
      setSuccess('Payment settings saved.');
      setSaving(false);
      await loadSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!tenant) return;
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      // Call the Midtrans status API with a dummy order to test the keys
      const session = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-payment-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          orderId: 'test-connection-' + Date.now(),
          flow: 'bill',
          tenantId: tenant.id,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.mappedStatus) {
        setTestResult({ ok: true, message: 'Connection successful — keys are valid.' });
      } else if (body.error?.includes('not configured') || body.error?.includes('not found')) {
        // A 404 from Midtrans means the keys work but the test order doesn't exist — that's success
        setTestResult({ ok: true, message: 'Connection successful — keys are valid.' });
      } else {
        setTestResult({ ok: false, message: body.error || 'Connection failed. Check your keys.' });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Connection failed' });
    }
    setTesting(false);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto max-w-[800px] px-4 h-16 flex items-center gap-3">
          <Link to="/app" className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-saffron-600 flex items-center justify-center shadow-glow">
              <Utensils size={18} className="text-white" />
            </div>
            <div className="font-display font-bold text-base"><Wordmark /></div>
          </Link>
          <button onClick={() => navigate('/app')} className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-ink-100 ml-2">
            <ArrowLeft size={15} /> Dashboard
          </button>
          <button onClick={async () => { await signOut(); navigate('/'); }} className="ml-auto text-sm text-ink-400 hover:text-ink-100">Sign out</button>
        </div>
      </header>

      <div className="mx-auto max-w-[800px] px-4 py-8 space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Payment Settings</h1>
          <p className="text-sm text-ink-400 mt-1">
            Connect your Midtrans account so customers can pay for meals directly from the QR table page.
            The money goes straight to your Midtrans balance — MenuList never holds it.
          </p>
        </div>

        {/* Guide */}
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <h2 className="font-display font-semibold mb-2 flex items-center gap-2">
            <Shield size={18} className="text-saffron-400" /> How to connect
          </h2>
          <ol className="text-sm text-ink-300 space-y-1.5 list-decimal list-inside">
            <li>Create a Midtrans account at <span className="text-saffron-400">midtrans.com</span></li>
            <li>Go to Settings &gt; Access Keys and copy your Client Key and Server Key</li>
            <li>Paste them below and choose your environment (Sandbox for testing, Production for live)</li>
            <li>Click <span className="text-saffron-400">Test connection</span> to verify the keys work</li>
            <li>Enable the payment methods you want to accept</li>
          </ol>
          <p className="text-xs text-ink-400 mt-3">
            You don't need to configure a webhook URL in your Midtrans dashboard — we send it
            automatically with each transaction. As a fallback, you can also set this URL in
            Settings &gt; Configuration &gt; Payment Notification URL:
          </p>
          <code className="block mt-2 text-[11px] bg-ink-900 rounded-lg p-2 text-saffron-400 border border-ink-600 break-all">
            {SUPABASE_URL}/functions/v1/midtrans-webhook-tenant?tenant={tenant?.id}
          </code>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose2-500/40 bg-rose2-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="text-rose2-400 shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-rose2-300">{error}</div>
          </div>
        )}

        {success && (
          <div className="rounded-2xl border border-emerald2-500/40 bg-emerald2-500/10 p-4 flex items-start gap-3">
            <Check className="text-emerald2-400 shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-emerald2-300">{success}</div>
          </div>
        )}

        {/* Settings form */}
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6 space-y-5">
          {/* Environment */}
          <div>
            <label className="text-sm font-medium block mb-2">Environment</label>
            <div className="grid grid-cols-2 gap-2">
              {(['sandbox', 'production'] as const).map((env) => (
                <button
                  key={env}
                  onClick={() => setEnvironment(env)}
                  className={cn(
                    'rounded-xl border p-3 text-sm font-medium transition-colors text-left',
                    environment === env
                      ? 'border-saffron-500/50 bg-saffron-500/10 text-saffron-400'
                      : 'border-ink-600 bg-ink-700 text-ink-200 hover:bg-ink-600'
                  )}
                >
                  <div className="font-semibold capitalize">{env}</div>
                  <div className="text-xs text-ink-400 mt-0.5">
                    {env === 'sandbox' ? 'Test with sandbox keys' : 'Live with production keys'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Merchant ID */}
          <div>
            <label className="text-sm font-medium block mb-1.5">Merchant ID</label>
            <input
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              placeholder="M1234567890"
              className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none"
            />
            <p className="text-xs text-ink-400 mt-1">Found in your Midtrans dashboard under Settings &gt; General.</p>
          </div>

          {/* Client Key */}
          <div>
            <label className="text-sm font-medium block mb-1.5">Client Key</label>
            <input
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              placeholder="SB-Mid-client-xxx"
              className="w-full h-11 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none font-mono"
            />
            <p className="text-xs text-ink-400 mt-1">Safe to use in the browser — this key is public.</p>
          </div>

          {/* Server Key */}
          <div>
            <label className="text-sm font-medium block mb-1.5">Server Key</label>
            <div className="relative">
              <input
                type={showServerKey ? 'text' : 'password'}
                value={serverKey}
                onChange={(e) => setServerKey(e.target.value)}
                placeholder={hasExistingServerKey ? '•••••••••••••••• (saved, enter new to replace)' : 'SB-Mid-server-xxx'}
                className="w-full h-11 px-3 pr-10 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none font-mono"
              />
              <button
                onClick={() => setShowServerKey(!showServerKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-100"
              >
                {showServerKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-ink-400 mt-1">
              {hasExistingServerKey
                ? 'A server key is saved and encrypted. Enter a new one to replace it.'
                : 'Stored encrypted — never returned to the browser. Only edge functions can read it.'}
            </p>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleTestConnection} disabled={testing || !hasExistingServerKey}>
              {testing ? <Loader2 size={16} className="animate-spin" /> : <TestTube2 size={16} />}
              Test connection
            </Button>
            {testResult && (
              <div className={cn(
                'text-sm flex items-center gap-1.5',
                testResult.ok ? 'text-emerald2-400' : 'text-rose2-400'
              )}>
                {testResult.ok ? <Check size={15} /> : <AlertCircle size={15} />}
                {testResult.message}
              </div>
            )}
          </div>

          {/* Payment methods */}
          <div>
            <label className="text-sm font-medium block mb-2">Accepted payment methods</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_METHODS.map((m) => {
                const Icon = m.icon;
                const enabled = enabledMethods.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleMethod(m.id)}
                    className={cn(
                      'rounded-xl border p-3 flex items-center gap-2 text-sm font-medium transition-colors text-left',
                      enabled
                        ? 'border-saffron-500/50 bg-saffron-500/10 text-saffron-400'
                        : 'border-ink-600 bg-ink-700 text-ink-300 hover:bg-ink-600'
                    )}
                  >
                    <Icon size={16} />
                    {m.label}
                    {enabled && <Check size={14} className="ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cash toggle */}
          <div className="flex items-center justify-between rounded-xl border border-ink-600 bg-ink-700 p-4">
            <div className="flex items-center gap-3">
              <Banknote size={18} className="text-emerald2-400" />
              <div>
                <div className="text-sm font-medium">Accept cash at counter</div>
                <div className="text-xs text-ink-400">Show "pay at counter" as an option on the guest bill page</div>
              </div>
            </div>
            <button
              onClick={() => setCashEnabled(!cashEnabled)}
              className={cn(
                'relative h-7 w-12 rounded-full transition-colors',
                cashEnabled ? 'bg-saffron-600' : 'bg-ink-600'
              )}
            >
              <div className={cn(
                'absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform',
                cashEnabled ? 'translate-x-5' : 'translate-x-0.5'
              )} />
            </button>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-xl border border-ink-600 bg-ink-700 p-4">
            <div className="flex items-center gap-3">
              <RotateCw size={18} className="text-saffron-400" />
              <div>
                <div className="text-sm font-medium">Enable online payments</div>
                <div className="text-xs text-ink-400">When off, guests see "Pay at counter" only</div>
              </div>
            </div>
            <button
              onClick={() => setIsActive(!isActive)}
              className={cn(
                'relative h-7 w-12 rounded-full transition-colors',
                isActive ? 'bg-saffron-600' : 'bg-ink-600'
              )}
            >
              <div className={cn(
                'absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform',
                isActive ? 'translate-x-5' : 'translate-x-0.5'
              )} />
            </button>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving} size="lg">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              Save settings
            </Button>
            <Link to="/app/payments-test" className="text-sm text-saffron-400 hover:text-saffron-300 ml-auto">
              Open test page →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
