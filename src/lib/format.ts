export const formatIDR = (minor: number): string => {
  const rupiah = Math.round(minor);
  return 'Rp ' + rupiah.toLocaleString('id-ID');
};

export const formatCompactIDR = (minor: number): string => {
  const r = Math.round(minor);
  if (r >= 1_000_000) return 'Rp ' + (r / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'jt';
  if (r >= 1_000) return 'Rp ' + (r / 1_000).toFixed(0) + 'rb';
  return 'Rp ' + r;
};

export const elapsedSeconds = (from: string, now: number = Date.now()): number => {
  return Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
};

export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const formatTime = (iso: string): string => {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const dayKey = (d: Date = new Date()): string =>
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];

export const isOutletOpenNow = (openingHours: Record<string, string[]>): boolean => {
  const ranges = openingHours[dayKey()];
  if (!ranges || ranges.length === 0) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const range of ranges) {
    const [start, end] = range.split('-');
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let endMin = eh * 60 + em;
    if (endMin <= sh * 60 + sm) endMin += 24 * 60; // crosses midnight
    const startMin = sh * 60 + sm;
    if (endMin > 24 * 60) {
      // range crosses midnight
      if (minutes >= startMin || minutes <= endMin - 24 * 60) return true;
    } else {
      if (minutes >= startMin && minutes <= endMin) return true;
    }
  }
  return false;
};

export const stationLabel: Record<string, string> = {
  kitchen: 'Hot Kitchen',
  bar: 'Bar',
  dessert: 'Dessert',
  coffee: 'Coffee',
  expo: 'Expo',
};

export const stationColor: Record<string, string> = {
  kitchen: 'saffron',
  bar: 'sky2',
  dessert: 'rose2',
  coffee: 'amber2',
  expo: 'emerald2',
};

export const orderItemStatusLabel: Record<string, string> = {
  received: 'Received',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  voided: 'Voided',
  rejected: 'Rejected',
};

export const tableStatusLabel: Record<string, string> = {
  available: 'Available',
  reserved: 'Reserved',
  occupied: 'Occupied',
  awaiting_payment: 'Awaiting payment',
  cleaning: 'Cleaning',
  out_of_service: 'Out of service',
};

export const tableStatusColor: Record<string, string> = {
  available: 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30',
  reserved: 'bg-sky2-500/15 text-sky2-400 border-sky2-500/30',
  occupied: 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30',
  awaiting_payment: 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30',
  cleaning: 'bg-ink-500/30 text-ink-200 border-ink-500/40',
  out_of_service: 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30',
};

export const reservationStatusLabel: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  seated: 'Seated',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const reservationStatusColor: Record<string, string> = {
  pending: 'bg-amber2-500/15 text-amber2-400 border-amber2-500/30',
  confirmed: 'bg-sky2-500/15 text-sky2-400 border-sky2-500/30',
  arrived: 'bg-saffron-500/15 text-saffron-400 border-saffron-500/30',
  seated: 'bg-emerald2-500/15 text-emerald2-400 border-emerald2-500/30',
  completed: 'bg-ink-500/30 text-ink-200 border-ink-500/40',
  cancelled: 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30',
  no_show: 'bg-rose2-500/15 text-rose2-400 border-rose2-500/30',
};

export const serviceRequestReasonLabel: Record<string, string> = {
  need_help: 'Need help',
  request_bill: 'Request bill',
  water_refill: 'Water / refill',
  clean_table: 'Clean table',
  cutlery: 'Cutlery / napkins',
  other: 'Other',
};

export const serviceRequestReasonIcon: Record<string, string> = {
  need_help: 'Hand',
  request_bill: 'ReceiptText',
  water_refill: 'GlassWater',
  clean_table: 'Sparkles',
  cutlery: 'Utensils',
  other: 'MessageCircle',
};

export const paymentMethodLabel: Record<string, string> = {
  cash: 'Cash',
  qris: 'QRIS / e-wallet',
  card: 'Card',
  transfer: 'Bank transfer',
  voucher: 'Voucher',
};

export const dietaryLabel: Record<string, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  halal: 'Halal',
  'gluten-free': 'Gluten-free',
  pescatarian: 'Pescatarian',
  gluten: 'Contains gluten',
};

export const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(' ');
