export type Station = 'kitchen' | 'bar' | 'dessert' | 'coffee' | 'expo';
export type TableStatus =
  | 'available'
  | 'reserved'
  | 'occupied'
  | 'awaiting_payment'
  | 'cleaning'
  | 'out_of_service';
export type OrderStatus =
  | 'received'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'closed'
  | 'voided';
export type OrderItemStatus =
  | 'received'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'voided'
  | 'rejected';
export type OrderSource = 'qr' | 'waiter' | 'web' | 'pos';
export type OrderType = 'dine_in' | 'takeaway';
export type ServiceRequestReason =
  | 'need_help'
  | 'request_bill'
  | 'water_refill'
  | 'clean_table'
  | 'cutlery'
  | 'other';
export type ServiceRequestStatus = 'sent' | 'seen' | 'on_the_way' | 'done';
export type BillStatus = 'open' | 'paid' | 'refunded';
export type PaymentMethod = 'cash' | 'qris' | 'card' | 'transfer' | 'voucher';
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Outlet {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  currency_code: string;
  timezone: string;
  tax_percent: number;
  service_charge_percent: number;
  opening_hours: Record<string, string[]>;
  order_approval_mode: 'auto' | 'waiter' | 'pay_first';
  min_order_minor: number;
  max_order_minor: number;
  idle_session_minutes: number;
  logo_url: string | null;
  hero_url: string | null;
  brand_color: string;
  accent_color: string;
  website_published: boolean;
  website_slug: string | null;
  payment_methods: string[];
  website_hero_title: string | null;
  website_tagline: string | null;
}

export interface Area {
  id: string;
  outlet_id: string;
  name: string;
  sort_order: number;
  allows_reservations: boolean;
  min_spend_minor: number;
  default_station: string;
  archived_at: string | null;
}

export interface RestaurantTable {
  id: string;
  area_id: string;
  outlet_id: string;
  label: string;
  min_seats: number;
  max_seats: number;
  shape: 'round' | 'square' | 'rect';
  pos_x: number;
  pos_y: number;
  rotation: number;
  status: TableStatus;
  notes: string | null;
  qr_token: string;
  pin: string | null;
}

export interface MenuCategory {
  id: string;
  outlet_id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  outlet_id: string;
  name: string;
  description: string | null;
  price_minor: number;
  photo_url: string | null;
  station: Station;
  prep_time_seconds: number;
  dietary_tags: string[];
  allergens: string[];
  calories: number | null;
  sku: string | null;
  available: boolean;
  sold_out: boolean;
  auto_sold_out: boolean;
  daily_limit: number | null;
  daily_sold: number;
  sort_order: number;
}

export interface MenuModifier {
  id: string;
  item_id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: MenuModifierOption[];
}

export interface MenuModifierOption {
  id: string;
  modifier_id: string;
  name: string;
  price_delta_minor: number;
  is_default: boolean;
  sort_order: number;
}

export interface TableSession {
  id: string;
  table_id: string;
  outlet_id: string;
  opened_at: string;
  closed_at: string | null;
  guest_count: number;
  reservation_id: string | null;
  status: 'open' | 'closed';
}

export interface Order {
  id: string;
  session_id: string;
  table_id: string;
  outlet_id: string;
  order_number: number;
  type: OrderType;
  source: OrderSource;
  status: OrderStatus;
  notes: string | null;
  guest_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemModifier {
  name: string;
  price_delta_minor: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  outlet_id: string;
  item_id: string;
  name: string;
  station: Station;
  quantity: number;
  unit_price_minor: number;
  modifiers: OrderItemModifier[];
  notes: string | null;
  status: OrderItemStatus;
  allergy_alert: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceRequest {
  id: string;
  table_id: string;
  outlet_id: string;
  reason: ServiceRequestReason;
  detail: string | null;
  status: ServiceRequestStatus;
  acknowledged_by: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface Bill {
  id: string;
  session_id: string;
  table_id: string;
  outlet_id: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  service_minor: number;
  tip_minor: number;
  total_minor: number;
  status: BillStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Payment {
  id: string;
  bill_id: string | null;
  tenant_id?: string | null;
  method: PaymentMethod;
  amount_minor: number;
  provider_ref: string | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  created_at: string;
  order_id?: string | null;
  split_ref?: string | null;
  gross_amount?: number | null;
  payment_type?: string | null;
  transaction_id?: string | null;
  raw_response?: Record<string, unknown> | null;
  paid_at?: string | null;
}

export interface Reservation {
  id: string;
  outlet_id: string;
  table_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  party_size: number;
  area_preference: string | null;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  status: ReservationStatus;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export type StaffRole = 'owner' | 'manager' | 'chef' | 'waiter' | 'cashier' | 'host' | 'dj';

export type TenantPlan = 'starter' | 'growth' | 'chain';
export type TenantStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'read_only' | 'cancelled';
export type BillingCycle = 'monthly' | 'yearly';

export interface Tenant {
  id: string;
  name: string;
  owner_user_id: string;
  country: string;
  is_demo: boolean;
  trial_ends_at: string;
  onboarding_step: number;
  payment_methods: string[];
  currency_code: string;
  created_at: string;
  updated_at: string;
  plan: TenantPlan;
  billing_cycle: BillingCycle;
  status: TenantStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  read_only_since: string | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  cancelled_at: string | null;
}

export interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan: TenantPlan;
  billing_cycle: BillingCycle;
  status: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  stripe_invoice_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  invoice_url: string | null;
  invoice_pdf: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  plan?: string | null;
  interval?: string | null;
  order_id?: string | null;
  snap_token?: string | null;
  paid_at?: string | null;
}

export interface PaymentProviderSettings {
  tenant_id: string;
  environment: 'sandbox' | 'production';
  merchant_id: string | null;
  client_key: string | null;
  enabled_methods: string[];
  cash_enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanOverrideRow {
  plan: TenantPlan;
  billing_cycle: BillingCycle;
  price_minor: number;
  updated_at: string;
}

export interface EmailLogRow {
  id: string;
  tenant_id: string | null;
  kind: string;
  recipient: string;
  subject: string;
  status: string;
  created_at: string;
  sent_at: string | null;
}

export interface Profile {
  id: string;
  tenant_id: string | null;
  role: StaffRole;
  full_name: string;
  email: string;
  pin_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffInvite {
  id: string;
  tenant_id: string;
  email: string;
  role: Exclude<StaffRole, 'owner'>;
  invited_by: string;
  token: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
  expires_at: string;
}
