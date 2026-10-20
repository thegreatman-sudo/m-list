import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Store, MapPin, Phone, Mail, Globe, Clock, Percent, Receipt,
  Bell, CreditCard, AlertTriangle, Check, Settings as SettingsIcon,
  Utensils, Building2, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTenantFromAuth } from '@/lib/tenant';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/format';
import { Button, Spinner, EmptyState } from '@/components/ui';
import type { Outlet } from '@/types';

type Tab = 'profile' | 'outlets' | 'tax' | 'orders' | 'receipt' | 'notifications' | 'payments' | 'danger';

const TABS: { id: Tab; label: string; icon: typeof Store }[] = [
  { id: 'profile', label: 'Restaurant profile', icon: Store },
  { id: 'outlets', label: 'Outlets', icon: Building2 },
  { id: 'tax', label: 'Tax & service', icon: Percent },
  { id: 'orders', label: 'Order settings', icon: Clock },
  { id: 'receipt', label: 'Receipt', icon: Receipt },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle },
];

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

export function SettingsPage() {
  const { tenant, refreshProfile } = useAuth();
  let tenantData;
  try {
    tenantData = useTenantFromAuth();
  } catch {
    tenantData = null;
  }

  const [tab, setTab] = useState<Tab>('profile');
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOutlet = useCallback(async () => {
    if (!tenantData?.outlet) { setLoading(false); return; }
    const { data } = await supabase
      .from('outlets')
      .select('*')
      .eq('id', tenantData.outlet.id)
      .maybeSingle();
    if (data) setOutlet(data as Outlet);
    setLoading(false);
  }, [tenantData?.outlet]);

  useEffect(() => {
    loadOutlet();
  }, [loadOutlet]);

  const saveOutlet = async (patch: Partial<Outlet>) => {
    if (!outlet) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase
      .from('outlets')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', outlet.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    await loadOutlet();
    await refreshProfile();
  };

  if (loading || !outlet || !tenant) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6">
      <div className="flex items-center gap-2 mb-5">
        <SettingsIcon size={20} className="text-saffron-400" />
        <h1 className="font-display text-xl font-bold">Settings</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Tab sidebar */}
        <div className="space-y-0.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left',
                  tab === t.id
                    ? 'bg-saffron-600/15 text-saffron-400 border border-saffron-500/30'
                    : 'text-ink-300 hover:bg-ink-700 border border-transparent'
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="min-w-0">
          {error && (
            <div className="mb-4 rounded-xl border border-rose2-500/30 bg-rose2-500/10 px-4 py-3 text-sm text-rose2-400">
              {error}
            </div>
          )}
          {saved && (
            <div className="mb-4 rounded-xl border border-emerald2-500/30 bg-emerald2-500/10 px-4 py-3 text-sm text-emerald2-400 flex items-center gap-2">
              <Check size={16} /> Saved
            </div>
          )}

          {tab === 'profile' && <ProfileTab outlet={outlet} tenantName={tenant.name} saving={saving} onSave={saveOutlet} />}
          {tab === 'outlets' && <OutletsTab outlet={outlet} />}
          {tab === 'tax' && <TaxTab outlet={outlet} saving={saving} onSave={saveOutlet} />}
          {tab === 'orders' && <OrdersTab outlet={outlet} saving={saving} onSave={saveOutlet} />}
          {tab === 'receipt' && <ReceiptTab outlet={outlet} saving={saving} onSave={saveOutlet} />}
          {tab === 'notifications' && <NotificationsTab outlet={outlet} saving={saving} onSave={saveOutlet} />}
          {tab === 'payments' && <PaymentsTab outlet={outlet} />}
          {tab === 'danger' && <DangerTab tenantName={tenant.name} />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-800 p-5 space-y-4">
      <h2 className="font-display font-semibold text-base">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-xs text-ink-400 block mb-1">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-ink-500 mt-1">{hint}</div>}
    </div>
  );
}

const inputCls = 'w-full h-10 px-3 rounded-xl bg-ink-700 border border-ink-600 text-sm focus:border-saffron-500 focus:outline-none';

function ProfileTab({ outlet, tenantName, saving, onSave }: {
  outlet: Outlet;
  tenantName: string;
  saving: boolean;
  onSave: (patch: Partial<Outlet>) => void;
}) {
  const [name, setName] = useState(outlet.name);
  const [businessType, setBusinessType] = useState(outlet.business_type ?? 'restaurant');
  const [phone, setPhone] = useState(outlet.phone ?? '');
  const [email, setEmail] = useState(outlet.email ?? '');
  const [address, setAddress] = useState(outlet.address ?? '');
  const [logoUrl, setLogoUrl] = useState(outlet.logo_url ?? '');
  const [heroUrl, setHeroUrl] = useState(outlet.hero_url ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(outlet.website_url ?? '');
  const [instagramUrl, setInstagramUrl] = useState(outlet.instagram_url ?? '');
  const [facebookUrl, setFacebookUrl] = useState(outlet.facebook_url ?? '');
  const [tiktokUrl, setTiktokUrl] = useState(outlet.tiktok_url ?? '');
  const [timezone, setTimezone] = useState(outlet.timezone);
  const [currency, setCurrency] = useState(outlet.currency_code);
  const [language, setLanguage] = useState(outlet.language ?? 'en');
  const [hours, setHours] = useState<Record<string, string[]>>(outlet.opening_hours ?? {});

  const setHoursForDay = (day: string, value: string) => {
    const ranges = value.split(',').map(s => s.trim()).filter(Boolean);
    setHours({ ...hours, [day]: ranges });
  };

  return (
    <div className="space-y-4">
      <Section title="Basic information">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Restaurant name">
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Business type">
            <select value={businessType} onChange={e => setBusinessType(e.target.value)} className={inputCls}>
              <option value="restaurant">Restaurant</option>
              <option value="cafe">Cafe</option>
              <option value="bar">Bar</option>
              <option value="cloud_kitchen">Cloud kitchen</option>
              <option value="food_truck">Food truck</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+62 ..." className={inputCls} />
          </Field>
          <Field label="Email">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="hello@restaurant.com" className={inputCls} />
          </Field>
        </div>
        <Field label="Address">
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, postal code" className={inputCls} />
        </Field>
      </Section>

      <Section title="Logo & cover image">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Logo URL" hint="Paste a link to your logo image">
            <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://…" className={inputCls} />
          </Field>
          <Field label="Cover image URL" hint="Used on your website hero">
            <input value={heroUrl} onChange={e => setHeroUrl(e.target.value)} placeholder="https://…" className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section title="Opening hours" hint="Enter time ranges separated by commas, e.g. 09:00-17:00, 18:00-23:00. Leave blank for closed.">
        <div className="space-y-2">
          {WEEKDAYS.map(day => (
            <div key={day} className="flex items-center gap-3">
              <span className="text-sm text-ink-300 w-24 shrink-0">{WEEKDAY_LABELS[day]}</span>
              <input
                value={(hours[day] ?? []).join(', ')}
                onChange={e => setHoursForDay(day, e.target.value)}
                placeholder="Closed"
                className={cn(inputCls, 'flex-1')}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Web & social">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Website URL">
            <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://…" className={inputCls} />
          </Field>
          <Field label="Instagram URL">
            <input value={instagramUrl} onChange={e => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/…" className={inputCls} />
          </Field>
          <Field label="Facebook URL">
            <input value={facebookUrl} onChange={e => setFacebookUrl(e.target.value)} placeholder="https://facebook.com/…" className={inputCls} />
          </Field>
          <Field label="TikTok URL">
            <input value={tiktokUrl} onChange={e => setTiktokUrl(e.target.value)} placeholder="https://tiktok.com/…" className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section title="Localization">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Timezone">
            <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputCls}>
              <option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
              <option value="Asia/Makassar">Asia/Makassar (WITA)</option>
              <option value="Asia/Jayapura">Asia/Jayapura (WIT)</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
              <option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur</option>
            </select>
          </Field>
          <Field label="Currency">
            <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
              <option value="IDR">IDR (Rp)</option>
              <option value="USD">USD ($)</option>
              <option value="SGD">SGD (S$)</option>
              <option value="MYR">MYR (RM)</option>
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={e => setLanguage(e.target.value)} className={inputCls}>
              <option value="en">English</option>
              <option value="id">Bahasa Indonesia</option>
            </select>
          </Field>
        </div>
      </Section>

      <Button
        onClick={() => onSave({
          name, business_type: businessType, phone: phone || null, email: email || null,
          address: address || null, logo_url: logoUrl || null, hero_url: heroUrl || null,
          website_url: websiteUrl || null, instagram_url: instagramUrl || null,
          facebook_url: facebookUrl || null, tiktok_url: tiktokUrl || null,
          timezone, currency_code: currency, language, opening_hours: hours,
        })}
        disabled={saving}
      >
        {saving ? <Spinner /> : <Check size={15} />} Save profile
      </Button>
    </div>
  );
}

function OutletsTab({ outlet }: { outlet: Outlet }) {
  return (
    <Section title="Outlets">
      <div className="rounded-xl border border-ink-600 bg-ink-700/40 p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-ink-700 border border-ink-600 flex items-center justify-center">
          <Building2 size={18} className="text-saffron-400" />
        </div>
        <div className="flex-1">
          <div className="font-medium">{outlet.name}</div>
          <div className="text-xs text-ink-400">{outlet.slug} · {outlet.timezone}</div>
        </div>
        <span className="rounded-full bg-emerald2-500/15 text-emerald2-400 border border-emerald2-500/30 px-2 py-0.5 text-[11px] font-medium">Active</span>
      </div>
      <p className="text-sm text-ink-400">
        Need more outlets? Upgrade to the Chain plan to manage multiple locations from one dashboard.
      </p>
      <Link to="/billing" className="inline-flex items-center gap-1 text-sm font-medium text-saffron-400 hover:text-saffron-300">
        Upgrade plan <ChevronRight size={14} />
      </Link>
    </Section>
  );
}

function TaxTab({ outlet, saving, onSave }: {
  outlet: Outlet;
  saving: boolean;
  onSave: (patch: Partial<Outlet>) => void;
}) {
  const [tax, setTax] = useState(String(outlet.tax_percent));
  const [service, setService] = useState(String(outlet.service_charge_percent));
  const [inclusive, setInclusive] = useState(outlet.tax_inclusive ?? false);
  const [rounding, setRounding] = useState(outlet.rounding_rule ?? 'none');

  return (
    <Section title="Tax & service charge">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tax percentage (%)" hint="e.g. 11 for PPN 11%">
          <input value={tax} onChange={e => setTax(e.target.value)} inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="Service charge (%)" hint="Optional gratuity added to every bill">
          <input value={service} onChange={e => setService(e.target.value)} inputMode="decimal" className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tax mode">
          <select value={inclusive ? 'inclusive' : 'exclusive'} onChange={e => setInclusive(e.target.value === 'inclusive')} className={inputCls}>
            <option value="exclusive">Exclusive (added on top of price)</option>
            <option value="inclusive">Inclusive (included in price)</option>
          </select>
        </Field>
        <Field label="Rounding rule">
          <select value={rounding} onChange={e => setRounding(e.target.value)} className={inputCls}>
            <option value="none">No rounding</option>
            <option value="nearest_100">Round to nearest 100</option>
            <option value="nearest_500">Round to nearest 500</option>
            <option value="nearest_1000">Round to nearest 1,000</option>
          </select>
        </Field>
      </div>
      <Button
        onClick={() => onSave({
          tax_percent: parseFloat(tax) || 0,
          service_charge_percent: parseFloat(service) || 0,
          tax_inclusive: inclusive,
          rounding_rule: rounding,
        })}
        disabled={saving}
      >
        {saving ? <Spinner /> : <Check size={15} />} Save tax settings
      </Button>
    </Section>
  );
}

function OrdersTab({ outlet, saving, onSave }: {
  outlet: Outlet;
  saving: boolean;
  onSave: (patch: Partial<Outlet>) => void;
}) {
  const [approvalMode, setApprovalMode] = useState(outlet.order_approval_mode);
  const [cancelWindow, setCancelWindow] = useState(String(outlet.order_cancel_window_minutes ?? 5));
  const [minOrder, setMinOrder] = useState(String(outlet.min_order_minor / 1000));
  const [sessionTimeout, setSessionTimeout] = useState(String(outlet.idle_session_minutes));
  const [reasons, setReasons] = useState<string[]>(outlet.call_waiter_reasons ?? ['need_help','request_bill','water_refill','clean_table','cutlery','other']);
  const [cooldown, setCooldown] = useState(String(outlet.call_waiter_cooldown_seconds ?? 30));

  const allReasons = ['need_help','request_bill','water_refill','clean_table','cutlery','other'];
  const reasonLabels: Record<string, string> = {
    need_help: 'Need help', request_bill: 'Request bill', water_refill: 'Water / refill',
    clean_table: 'Clean table', cutlery: 'Cutlery / napkins', other: 'Other',
  };

  const toggleReason = (r: string) => {
    setReasons(reasons.includes(r) ? reasons.filter(x => x !== r) : [...reasons, r]);
  };

  return (
    <Section title="Order settings">
      <Field label="Order approval mode" hint="How guest orders from QR are handled">
        <select value={approvalMode} onChange={e => setApprovalMode(e.target.value as Outlet['order_approval_mode'])} className={inputCls}>
          <option value="auto">Auto-send to kitchen</option>
          <option value="waiter">Waiter approves first</option>
          <option value="pay_first">Pay before order</option>
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Order cancel window (minutes)" hint="Guests can cancel within this time">
          <input value={cancelWindow} onChange={e => setCancelWindow(e.target.value)} inputMode="numeric" className={inputCls} />
        </Field>
        <Field label="Minimum order (in thousands)" hint="e.g. 25 = Rp 25,000">
          <input value={minOrder} onChange={e => setMinOrder(e.target.value)} inputMode="numeric" className={inputCls} />
        </Field>
      </div>
      <Field label="Table session timeout (minutes)" hint="Auto-close idle sessions after this long">
        <input value={sessionTimeout} onChange={e => setSessionTimeout(e.target.value)} inputMode="numeric" className={inputCls} />
      </Field>
      <div>
        <label className="text-xs text-ink-400 block mb-1.5">Call-waiter reasons</label>
        <div className="flex flex-wrap gap-1.5">
          {allReasons.map(r => (
            <button
              key={r}
              onClick={() => toggleReason(r)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border', reasons.includes(r) ? 'bg-saffron-500/15 border-saffron-500/40 text-saffron-400' : 'border-ink-600 text-ink-300')}
            >
              {reasonLabels[r]}
            </button>
          ))}
        </div>
      </div>
      <Field label="Call-waiter cooldown (seconds)" hint="Prevent spam — minimum time between calls from the same table">
        <input value={cooldown} onChange={e => setCooldown(e.target.value)} inputMode="numeric" className={inputCls} />
      </Field>
      <Button
        onClick={() => onSave({
          order_approval_mode: approvalMode,
          order_cancel_window_minutes: parseInt(cancelWindow) || 5,
          min_order_minor: Math.round((parseFloat(minOrder) || 0) * 1000),
          idle_session_minutes: parseInt(sessionTimeout) || 180,
          call_waiter_reasons: reasons,
          call_waiter_cooldown_seconds: parseInt(cooldown) || 30,
        })}
        disabled={saving}
      >
        {saving ? <Spinner /> : <Check size={15} />} Save order settings
      </Button>
    </Section>
  );
}

function ReceiptTab({ outlet, saving, onSave }: {
  outlet: Outlet;
  saving: boolean;
  onSave: (patch: Partial<Outlet>) => void;
}) {
  const [header, setHeader] = useState(outlet.receipt_header ?? '');
  const [footer, setFooter] = useState(outlet.receipt_footer ?? '');
  const [paperSize, setPaperSize] = useState(outlet.receipt_paper_size ?? '80mm');

  return (
    <Section title="Receipt settings">
      <Field label="Receipt header" hint="Printed at the top — usually your restaurant name and address">
        <textarea value={header} onChange={e => setHeader(e.target.value)} rows={2} className={cn(inputCls, 'h-auto py-2 resize-none')} />
      </Field>
      <Field label="Receipt footer" hint="Printed at the bottom — e.g. 'Thank you, come again!'">
        <textarea value={footer} onChange={e => setFooter(e.target.value)} rows={2} className={cn(inputCls, 'h-auto py-2 resize-none')} />
      </Field>
      <Field label="Paper size">
        <select value={paperSize} onChange={e => setPaperSize(e.target.value)} className={inputCls}>
          <option value="58mm">58mm (small)</option>
          <option value="80mm">80mm (standard)</option>
          <option value="a4">A4</option>
        </select>
      </Field>
      <Button
        onClick={() => onSave({
          receipt_header: header || null,
          receipt_footer: footer || null,
          receipt_paper_size: paperSize,
        })}
        disabled={saving}
      >
        {saving ? <Spinner /> : <Check size={15} />} Save receipt settings
      </Button>
    </Section>
  );
}

function NotificationsTab({ outlet, saving, onSave }: {
  outlet: Outlet;
  saving: boolean;
  onSave: (patch: Partial<Outlet>) => void;
}) {
  const [sound, setSound] = useState(outlet.notification_sound ?? true);
  const [email, setEmail] = useState(outlet.notification_email ?? true);
  const [waTemplate, setWaTemplate] = useState(outlet.notification_whatsapp_template ?? '');

  return (
    <Section title="Notifications">
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)} className="h-4 w-4 accent-saffron-500" />
          <span className="text-sm">Play sound on new order and bell call</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} className="h-4 w-4 accent-saffron-500" />
          <span className="text-sm">Send email notifications for new orders</span>
        </label>
      </div>
      <Field label="WhatsApp message template" hint="Used when sending order confirmations via WhatsApp">
        <textarea value={waTemplate} onChange={e => setWaTemplate(e.target.value)} rows={3} placeholder="Hi {name}, your order #{number} from {restaurant} is confirmed." className={cn(inputCls, 'h-auto py-2 resize-none')} />
      </Field>
      <Button
        onClick={() => onSave({
          notification_sound: sound,
          notification_email: email,
          notification_whatsapp_template: waTemplate || null,
        })}
        disabled={saving}
      >
        {saving ? <Spinner /> : <Check size={15} />} Save notification settings
      </Button>
    </Section>
  );
}

function PaymentsTab({ outlet }: { outlet: Outlet }) {
  return (
    <Section title="Payment methods">
      <p className="text-sm text-ink-400">
        Configure Midtrans payment keys and accepted payment methods in the payment settings page.
      </p>
      <Link to="/app/settings" className="inline-flex items-center gap-1 text-sm font-medium text-saffron-400 hover:text-saffron-300">
        Payment configuration <ChevronRight size={14} />
      </Link>
      <div className="pt-2">
        <div className="text-xs text-ink-400 mb-2">Currently enabled on this outlet:</div>
        <div className="flex flex-wrap gap-1.5">
          {outlet.payment_methods.map(m => (
            <span key={m} className="rounded-full bg-ink-700 border border-ink-600 px-3 py-1 text-xs font-medium capitalize">{m}</span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function DangerTab({ tenantName }: { tenantName: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Section title="Danger zone">
      <div className="rounded-xl border border-rose2-500/30 bg-rose2-500/5 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose2-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-sm">Export your data</div>
            <div className="text-xs text-ink-400 mt-0.5">Download all your restaurant data as a backup.</div>
          </div>
          <Button size="sm" variant="outline">Export</Button>
        </div>
        <div className="border-t border-ink-700 pt-3 flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose2-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-sm">Delete account</div>
            <div className="text-xs text-ink-400 mt-0.5">Permanently delete {tenantName} and all associated data. This cannot be undone.</div>
          </div>
          {confirming ? (
            <Button size="sm" variant="danger" onClick={() => setConfirming(false)}>Confirm delete</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Delete</Button>
          )}
        </div>
      </div>
    </Section>
  );
}
