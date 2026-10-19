import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Utensils, Clock, MapPin, ArrowRight, AlertCircle, CalendarDays } from 'lucide-react';
import { publicSiteData } from '@/lib/guest';
import type { PublicSite } from '@/lib/guest';
import { formatIDR, isOutletOpenNow, dayKey } from '@/lib/format';
import { Spinner } from '@/components/ui';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function PublicSitePage() {
  const { slug } = useParams<{ slug: string }>();
  const [site, setSite] = useState<PublicSite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    publicSiteData(slug).then((res) => {
      if ('error' in res) setError(res.error);
      else setSite(res);
      setLoading(false);
    });
  }, [slug]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-ink-900"><Spinner className="h-8 w-8" /></div>;
  }

  if (error || !site) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 text-ink-100 px-4">
        <div className="text-center max-w-md">
          <AlertCircle size={40} className="mx-auto text-ink-500 mb-4" />
          <h1 className="font-display text-xl font-bold">Site not found</h1>
          <p className="mt-2 text-sm text-ink-400">{error ?? 'This restaurant website does not exist or is not published.'}</p>
          <Link to="/" className="inline-flex items-center gap-1.5 mt-6 h-10 px-5 rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white text-sm font-semibold">
            <Utensils size={15} /> MenuList home
          </Link>
        </div>
      </div>
    );
  }

  const { outlet, menu } = site;
  const today = dayKey();
  const openNow = isOutletOpenNow(outlet.opening_hours);

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      {/* Hero */}
      <header className="relative overflow-hidden">
        {outlet.hero_url ? (
          <div className="absolute inset-0">
            <img src={outlet.hero_url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/70 to-ink-900/40" />
          </div>
        ) : (
          <div className="absolute inset-0 df-hero-glow" />
        )}
        <div className="relative mx-auto max-w-3xl px-4 pt-20 pb-16 text-center">
          {outlet.logo_url && (
            <img src={outlet.logo_url} alt={outlet.name} className="h-16 w-16 rounded-2xl object-cover mx-auto mb-5 border border-ink-600" />
          )}
          <h1 className="font-display text-3xl sm:text-5xl font-bold leading-tight">
            {outlet.website_hero_title ?? outlet.name}
          </h1>
          {outlet.website_tagline && (
            <p className="mt-3 text-lg text-ink-300 leading-relaxed">{outlet.website_tagline}</p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${openNow ? 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30' : 'bg-ink-700 text-ink-300 border-ink-600'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${openNow ? 'bg-emerald2-500 df-pulse' : 'bg-ink-500'}`} />
              {openNow ? 'Open now' : 'Closed'}
            </span>
            <a
              href={`https://wa.me/?text=I'd%20like%20to%20book%20a%20table%20at%20${encodeURIComponent(outlet.name)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-saffron-600 hover:bg-saffron-500 text-white text-sm font-semibold shadow-glow transition-colors"
            >
              <CalendarDays size={15} /> Book a table
            </a>
          </div>
        </div>
      </header>

      {/* Opening hours */}
      <section className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6">
          <h2 className="font-display font-semibold flex items-center gap-2 mb-4">
            <Clock size={18} className="text-saffron-400" /> Opening hours
          </h2>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            {DAYS.map((d) => {
              const ranges = outlet.opening_hours[d];
              return (
                <div key={d} className={`flex items-center justify-between rounded-lg px-3 py-2 ${d === today ? 'bg-saffron-500/10 border border-saffron-500/20' : ''}`}>
                  <span className="text-ink-300">{DAY_LABELS[d]}</span>
                  <span className={ranges?.length ? 'text-ink-100' : 'text-ink-500'}>
                    {ranges?.length ? ranges.join(', ') : 'Closed'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Menu */}
      <section className="mx-auto max-w-3xl px-4 pb-20">
        <h2 className="font-display text-2xl font-bold mb-6">Menu</h2>
        {menu.length === 0 ? (
          <p className="text-sm text-ink-400">The menu is being updated. Please check back soon.</p>
        ) : (
          <div className="space-y-10">
            {menu.map((cat) => (
              <div key={cat.category}>
                <h3 className="font-display text-lg font-semibold text-saffron-400 mb-4">{cat.category}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {cat.items.map((item) => (
                    <div key={item.name} className="flex gap-4 rounded-2xl border border-ink-600 bg-ink-800 p-4 hover:border-ink-500 transition-colors">
                      {item.photo_url && (
                        <img src={item.photo_url} alt={item.name} className="h-16 w-16 rounded-xl object-cover shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{item.name}</div>
                        {item.description && <p className="text-xs text-ink-400 mt-1 leading-relaxed line-clamp-2">{item.description}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="font-display font-semibold text-saffron-400">{formatIDR(item.price_minor)}</span>
                          {item.dietary_tags?.map((tag) => (
                            <span key={tag} className="text-[10px] rounded-full border border-ink-600 px-2 py-0.5 text-ink-400 capitalize">{tag.replace('-', ' ')}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-700 bg-ink-850">
        <div className="mx-auto max-w-3xl px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-ink-500" />
            <span className="text-sm text-ink-400">{outlet.name}</span>
          </div>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-300">
            Powered by MenuList <ArrowRight size={12} />
          </Link>
        </div>
      </footer>
    </div>
  );
}
