import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

interface BadgeProps {
  children: ReactNode;
  className?: string;
}
export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className
      )}
    >
      {children}
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
}
export function Button({
  variant = 'primary',
  size = 'md',
  full,
  className,
  children,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none select-none';
  const variants: Record<string, string> = {
    primary:
      'bg-saffron-600 text-white hover:bg-saffron-500 shadow-glow disabled:shadow-none',
    secondary: 'bg-ink-700 text-ink-100 hover:bg-ink-600 border border-ink-600',
    ghost: 'text-ink-200 hover:bg-ink-700',
    danger: 'bg-rose2-600 text-white hover:bg-rose2-500',
    outline: 'border border-ink-500 text-ink-100 hover:bg-ink-700',
  };
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  };
  return (
    <button
      className={cn(base, variants[variant], sizes[size], full && 'w-full', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-ink-600 bg-ink-800 shadow-card',
        onClick && 'cursor-pointer hover:border-ink-500 transition-colors',
        className
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-500 border-t-saffron-500',
        className
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {icon && <div className="text-ink-400">{icon}</div>}
      <div className="text-ink-200 font-medium">{title}</div>
      {hint && <div className="text-sm text-ink-400 max-w-sm">{hint}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  title,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm df-fade"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full bg-ink-800 border border-ink-600 rounded-t-2xl sm:rounded-2xl shadow-card max-h-[92vh] overflow-y-auto df-slide-up',
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-800/95 backdrop-blur px-5 py-4">
            <h3 className="font-display text-lg font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-100"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, show }: { message: string; show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 df-slide-up">
      <div className="rounded-full bg-ink-700 border border-ink-500 px-4 py-2 text-sm text-ink-100 shadow-card">
        {message}
      </div>
    </div>
  );
}
