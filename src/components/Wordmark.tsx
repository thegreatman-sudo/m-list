import { APP_NAME } from '@/config/brand';

// Text wordmark: base word in default color, last 4 characters in the accent
// color ("MenuList" → "Menu" + "List"), matching the previous visual style.
export function Wordmark({ className = '' }: { className?: string }) {
  const accentStart = APP_NAME.length - 4;
  return (
    <span className={className}>
      {APP_NAME.slice(0, accentStart)}
      <span className="text-saffron-500">{APP_NAME.slice(accentStart)}</span>
    </span>
  );
}
