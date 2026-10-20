import { Link } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';

export function PlaceholderPage({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-[800px] px-4 py-16">
      <div className="flex flex-col items-center text-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-ink-800 border border-ink-600 flex items-center justify-center">
          <Construction size={28} className="text-saffron-400" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold">{title}</h1>
          <p className="text-sm text-ink-400 mt-1 max-w-md">
            {hint ?? 'This section is being built. Your data is saved and ready.'}
          </p>
        </div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-saffron-400 hover:text-saffron-300 mt-2"
        >
          Back to dashboard <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
