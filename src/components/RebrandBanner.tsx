import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { LEGACY_APP_NAME, APP_NAME } from '@/config/brand';

const STORAGE_KEY = 'menulist_rebrand_banner_dismissed';
const BANNER_DEADLINE = new Date('2026-11-17').getTime(); // 30 days from Oct 18

export function RebrandBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && Date.now() < BANNER_DEADLINE) {
      setDismissed(true);
    } else if (Date.now() >= BANNER_DEADLINE) {
      setDismissed(true);
    } else {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setDismissed(true);
  };

  return (
    <div className="rounded-2xl border border-sky2-500/30 bg-sky2-500/10 p-4 flex items-start gap-3 df-slide-up">
      <Sparkles className="text-sky2-400 shrink-0 mt-0.5" size={20} />
      <div className="text-sm flex-1">
        <div className="font-semibold text-sky2-300">
          {LEGACY_APP_NAME} is now {APP_NAME}
        </div>
        <div className="text-sky2-200/80 mt-0.5">
          Same product, same login, same data. Your printed QR codes keep working.
        </div>
        <Link to="/rebrand" className="inline-flex items-center gap-1 mt-2 text-sky2-300 font-medium hover:text-sky2-200">
          Learn more
        </Link>
      </div>
      <button onClick={close} className="text-sky2-400 hover:text-sky2-300 shrink-0 mt-0.5" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
