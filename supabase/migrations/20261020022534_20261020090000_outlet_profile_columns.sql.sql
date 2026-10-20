/*
# Add restaurant profile columns to outlets

1. Modified tables
- `outlets`: adds business_type, phone, email, address, map_lat, map_lng, website_url, instagram_url, facebook_url, tiktok_url, language, receipt_header, receipt_footer, receipt_paper_size, notification_sound, notification_email, notification_whatsapp_template, tax_inclusive, rounding_rule, order_cancel_window_minutes, call_waiter_reasons, call_waiter_cooldown_seconds, business_type on tenants.
- `tenants`: adds business_type, phone, email, address, website_url, social links.

2. Security
- No new tables. RLS already enabled on outlets and tenants.
- Existing policies remain unchanged — these columns are accessible to the same authenticated users.

3. Notes
- All columns are nullable or have safe defaults so existing rows are unaffected.
- These columns support the Settings page (profile, tax, order rules, receipt, notifications).
*/

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'restaurant';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS map_lat double precision;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS map_lng double precision;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tiktok_url text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS language text DEFAULT 'en';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS receipt_header text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS receipt_footer text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS receipt_paper_size text DEFAULT '80mm';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS notification_sound boolean DEFAULT true;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS notification_email boolean DEFAULT true;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS notification_whatsapp_template text;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tax_inclusive boolean DEFAULT false;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS rounding_rule text DEFAULT 'none';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS order_cancel_window_minutes integer DEFAULT 5;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS call_waiter_reasons text[] DEFAULT ARRAY['need_help','request_bill','water_refill','clean_table','cutlery','other'];
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS call_waiter_cooldown_seconds integer DEFAULT 30;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'restaurant';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tiktok_url text;
