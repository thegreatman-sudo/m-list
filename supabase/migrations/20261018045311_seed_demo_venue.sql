/*
# Seed demo venue: "Saffron & Smoke"

1. Creates one outlet "Saffron & Smoke" with tax/service charge and branding.
2. Creates 3 areas: Main Dining, Bar Counter, Rooftop Terrace.
3. Creates 8 tables across the areas with random QR tokens.
4. Creates 5 menu categories and ~20 menu items with stations, dietary tags, photos,
   prep times, and a few modifier groups (size, sugar, doneness, add-ons).
5. Sets brand color (warm charcoal) and accent (saffron orange) — NOT purple.
6. No auth/seed users — single-tenant demo with anon access.

Money uses IDR minor units (IDR has no minor denomination but we keep integer
rupiah values directly, so 45000 = Rp 45.000).
*/

-- Outlet
INSERT INTO outlets (id, name, slug, currency_code, timezone, tax_percent, service_charge_percent, opening_hours, order_approval_mode, min_order_minor, max_order_minor, idle_session_minutes, brand_color, accent_color, hero_url)
SELECT '11111111-1111-1111-1111-111111111111', 'Saffron & Smoke', 'saffron-smoke', 'IDR', 'Asia/Jakarta', 11, 5,
  '{"mon":["11:00-22:00"],"tue":["11:00-22:00"],"wed":["11:00-22:00"],"thu":["11:00-23:00"],"fri":["11:00-00:00"],"sat":["10:00-00:00"],"sun":["10:00-22:00"]}'::jsonb,
  'auto', 20000, 50000000, 180, '#1c1917', '#ea580c',
  'https://images.pexels.com/photos/941861/pexels-photo-941861.jpeg?auto=compress&cs=tinysrgb&w=1600'
WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE id = '11111111-1111-1111-1111-111111111111');

-- Areas
INSERT INTO areas (id, outlet_id, name, sort_order, allows_reservations, default_station)
SELECT '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Main Dining', 1, true, 'kitchen'
WHERE NOT EXISTS (SELECT 1 FROM areas WHERE id = '21111111-1111-1111-1111-111111111111');

INSERT INTO areas (id, outlet_id, name, sort_order, allows_reservations, default_station)
SELECT '22111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Bar Counter', 2, false, 'bar'
WHERE NOT EXISTS (SELECT 1 FROM areas WHERE id = '22111111-1111-1111-1111-111111111111');

INSERT INTO areas (id, outlet_id, name, sort_order, allows_reservations, default_station)
SELECT '23111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Rooftop Terrace', 3, true, 'kitchen'
WHERE NOT EXISTS (SELECT 1 FROM areas WHERE id = '23111111-1111-1111-1111-111111111111');

-- Tables
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '30111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'T1', 2, 4, 'round', 120, 120, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '30111111-1111-1111-1111-111111111111');
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '30211111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'T2', 2, 4, 'square', 280, 120, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '30211111-1111-1111-1111-111111111111');
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '30311111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'T3', 4, 6, 'rect', 440, 120, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '30311111-1111-1111-1111-111111111111');
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '30411111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'T4', 2, 4, 'round', 120, 260, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '30411111-1111-1111-1111-111111111111');
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '30511111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'T5', 4, 8, 'rect', 440, 260, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '30511111-1111-1111-1111-111111111111');

INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '31111111-1111-1111-1111-111111111111', '22111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'B1', 1, 2, 'square', 80, 100, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '31111111-1111-1111-1111-111111111111');
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '31211111-1111-1111-1111-111111111111', '22111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'B2', 1, 2, 'square', 200, 100, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '31211111-1111-1111-1111-111111111111');

INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '32111111-1111-1111-1111-111111111111', '23111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'R1', 2, 4, 'round', 160, 140, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '32111111-1111-1111-1111-111111111111');
INSERT INTO tables (id, area_id, outlet_id, label, min_seats, max_seats, shape, pos_x, pos_y, status)
SELECT '32211111-1111-1111-1111-111111111111', '23111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'R2', 4, 6, 'rect', 360, 140, 'available'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id = '32211111-1111-1111-1111-111111111111');

-- Menu categories
INSERT INTO menu_categories (id, outlet_id, name, sort_order)
SELECT '40111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Starters', 1
WHERE NOT EXISTS (SELECT 1 FROM menu_categories WHERE id = '40111111-1111-1111-1111-111111111111');
INSERT INTO menu_categories (id, outlet_id, name, sort_order)
SELECT '40211111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Mains', 2
WHERE NOT EXISTS (SELECT 1 FROM menu_categories WHERE id = '40211111-1111-1111-1111-111111111111');
INSERT INTO menu_categories (id, outlet_id, name, sort_order)
SELECT '40311111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Desserts', 3
WHERE NOT EXISTS (SELECT 1 FROM menu_categories WHERE id = '40311111-1111-1111-1111-111111111111');
INSERT INTO menu_categories (id, outlet_id, name, sort_order)
SELECT '40411111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Cocktails & Bar', 4
WHERE NOT EXISTS (SELECT 1 FROM menu_categories WHERE id = '40411111-1111-1111-1111-111111111111');
INSERT INTO menu_categories (id, outlet_id, name, sort_order)
SELECT '40511111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Coffee & Tea', 5
WHERE NOT EXISTS (SELECT 1 FROM menu_categories WHERE id = '40511111-1111-1111-1111-111111111111');

-- Menu items
-- Starters
INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '50111111-1111-1111-1111-111111111111', '40111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Crispy Calamari', 'Lightly battered calamari with smoked paprika aioli and lemon.', 78000,
  'https://images.pexels.com/photos/566566/pexels-photo-566566.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 480, ARRAY['gluten'], ARRAY['shellfish','gluten','egg'], 420, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '50111111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '50211111-1111-1111-1111-111111111111', '40111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Gado Gado Salad', 'Seasonal vegetables, boiled egg, tofu and peanut sauce.', 62000,
  'https://images.pexels.com/photos/1213710/pexels-photo-1213710.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 360, ARRAY['vegetarian'], ARRAY['peanut','egg','soy'], 380, true, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '50211111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '50311111-1111-1111-1111-111111111111', '40111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Satay Platter', 'Chicken satay skewers grilled over coconut husk, peanut sauce.', 89000,
  'https://images.pexels.com/photos/461198/pexels-photo-461198.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 540, ARRAY['halal'], ARRAY['peanut','soy'], 510, true, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '50311111-1111-1111-1111-111111111111');

-- Mains
INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '51111111-1111-1111-1111-111111111111', '40211111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Nasi Goreng Spesial', 'Smoky fried rice with chicken, prawn, fried egg and krupuk.', 95000,
  'https://images.pexels.com/photos/699953/pexels-photo-699953.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 600, ARRAY['halal'], ARRAY['shellfish','egg','soy'], 680, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '51111111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '51211111-1111-1111-1111-111111111111', '40211111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Beef Rendang', 'Slow-braised beef in coconut milk and 14 spices, served with rice.', 128000,
  'https://images.pexels.com/photos/2474661/pexels-photo-2474661.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 900, ARRAY['halal','gluten-free'], ARRAY['dairy'], 720, true, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '51211111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '51311111-1111-1111-1111-111111111111', '40211111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Wood-Fired Margherita', 'San Marzano tomato, fresh mozzarella, basil, sourdough crust.', 110000,
  'https://images.pexels.com/photos/708587/pexels-photo-708587.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 540, ARRAY['vegetarian'], ARRAY['gluten','dairy'], 780, true, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '51311111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '51411111-1111-1111-1111-111111111111', '40211111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Grilled Salmon', 'Atlantic salmon, charred lemon, herb butter, seasonal greens.', 145000,
  'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
  'kitchen', 720, ARRAY['gluten-free','pescatarian'], ARRAY['fish'], 540, true, 4
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '51411111-1111-1111-1111-111111111111');

-- Desserts
INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '52111111-1111-1111-1111-111111111111', '40311111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Sticky Date Pudding', 'Warm sponge with toffee sauce and salted caramel ice cream.', 58000,
  'https://images.pexels.com/photos/1854652/pexels-photo-1854652.jpeg?auto=compress&cs=tinysrgb&w=800',
  'dessert', 420, ARRAY['vegetarian'], ARRAY['dairy','egg','gluten'], 620, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '52111111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '52211111-1111-1111-1111-111111111111', '40311111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Es Cendol', 'Pandan jelly, coconut milk, palm sugar syrup, crushed ice.', 38000,
  'https://images.pexels.com/photos/3718932/pexels-photo-3718932.jpeg?auto=compress&cs=tinysrgb&w=800',
  'dessert', 240, ARRAY['vegetarian','halal'], ARRAY['coconut'], 320, true, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '52211111-1111-1111-1111-111111111111');

-- Cocktails & Bar
INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '53111111-1111-1111-1111-111111111111', '40411111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Smoked Old Fashioned', 'Bourbon, demerara, aromatic bitters, applewood smoke.', 125000,
  'https://images.pexels.com/photos/602750/pexels-photo-602750.jpeg?auto=compress&cs=tinysrgb&w=800',
  'bar', 180, ARRAY['vegan'], ARRAY['none'], 220, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '53111111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '53211111-1111-1111-1111-111111111111', '40411111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Passion Mojito', 'White rum, passion fruit, lime, mint, soda.', 98000,
  'https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=800',
  'bar', 150, ARRAY['vegan','gluten-free'], ARRAY['none'], 190, true, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '53211111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '53311111-1111-1111-1111-111111111111', '40411111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Tropical Negroni', 'Gin, Campari, sweet vermouth, splash of pineapple.', 118000,
  'https://images.pexels.com/photos/1034362/pexels-photo-1034362.jpeg?auto=compress&cs=tinysrgb&w=800',
  'bar', 150, ARRAY['vegan'], ARRAY['none'], 200, true, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '53311111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '53411111-1111-1111-1111-111111111111', '40411111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Fresh Coconut Water', 'Whole young coconut, served chilled with a straw.', 32000,
  'https://images.pexels.com/photos/327490/pexels-photo-327490.jpeg?auto=compress&cs=tinysrgb&w=800',
  'bar', 60, ARRAY['vegan','gluten-free','halal'], ARRAY['none'], 90, true, 4
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '53411111-1111-1111-1111-111111111111');

-- Coffee & Tea
INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '54111111-1111-1111-1111-111111111111', '40511111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Es Kopi Susu', 'Double shot robusta, palm sugar, fresh milk over ice.', 32000,
  'https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=800',
  'coffee', 120, ARRAY['vegetarian'], ARRAY['dairy'], 140, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '54111111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '54211111-1111-1111-1111-111111111111', '40511111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Cappuccino', 'Double espresso, steamed milk, cocoa dusting.', 36000,
  'https://images.pexels.com/photos/3020919/pexels-photo-3020919.jpeg?auto=compress&cs=tinysrgb&w=800',
  'coffee', 120, ARRAY['vegetarian'], ARRAY['dairy'], 120, true, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '54211111-1111-1111-1111-111111111111');

INSERT INTO menu_items (id, category_id, outlet_id, name, description, price_minor, photo_url, station, prep_time_seconds, dietary_tags, allergens, calories, available, sort_order)
SELECT '54311111-1111-1111-1111-111111111111', '40511111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'Hot Lemon Ginger Tea', 'Fresh ginger, lemon, raw honey.', 28000,
  'https://images.pexels.com/photos/1417945/pexels-photo-1417945.jpeg?auto=compress&cs=tinysrgb&w=800',
  'coffee', 180, ARRAY['vegan','gluten-free','halal'], ARRAY['none'], 60, true, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE id = '54311111-1111-1111-1111-111111111111');

-- Modifiers: Beef Rendang doneness
INSERT INTO menu_modifiers (id, item_id, name, required, min_select, max_select, sort_order)
SELECT '60111111-1111-1111-1111-111111111111', '51211111-1111-1111-1111-111111111111', 'Doneness', true, 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_modifiers WHERE id = '60111111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '61111111-1111-1111-1111-111111111111', '60111111-1111-1111-1111-111111111111', 'Medium', 0, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '61111111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '61211111-1111-1111-1111-111111111111', '60111111-1111-1111-1111-111111111111', 'Medium Well', 0, false, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '61211111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '61311111-1111-1111-1111-111111111111', '60111111-1111-1111-1111-111111111111', 'Well Done', 0, false, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '61311111-1111-1111-1111-111111111111');

-- Modifiers: Es Kopi Susu sugar level
INSERT INTO menu_modifiers (id, item_id, name, required, min_select, max_select, sort_order)
SELECT '62111111-1111-1111-1111-111111111111', '54111111-1111-1111-1111-111111111111', 'Sugar Level', true, 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_modifiers WHERE id = '62111111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '63111111-1111-1111-1111-111111111111', '62111111-1111-1111-1111-111111111111', 'Normal', 0, true, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '63111111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '63211111-1111-1111-1111-111111111111', '62111111-1111-1111-1111-111111111111', 'Less Sugar', 0, false, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '63211111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '63311111-1111-1111-1111-111111111111', '62111111-1111-1111-1111-111111111111', 'No Sugar', 0, false, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '63311111-1111-1111-1111-111111111111');

-- Modifiers: Nasi Goreng add-ons (multi)
INSERT INTO menu_modifiers (id, item_id, name, required, min_select, max_select, sort_order)
SELECT '64111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', 'Add-ons', false, 0, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_modifiers WHERE id = '64111111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '65111111-1111-1111-1111-111111111111', '64111111-1111-1111-1111-111111111111', 'Extra Egg', 8000, false, 1
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '65111111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '65211111-1111-1111-1111-111111111111', '64111111-1111-1111-1111-111111111111', 'Extra Krupuk', 6000, false, 2
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '65211111-1111-1111-1111-111111111111');
INSERT INTO menu_modifier_options (id, modifier_id, name, price_delta_minor, is_default, sort_order)
SELECT '65311111-1111-1111-1111-111111111111', '64111111-1111-1111-1111-111111111111', 'Extra Spicy', 0, false, 3
WHERE NOT EXISTS (SELECT 1 FROM menu_modifier_options WHERE id = '65311111-1111-1111-1111-111111111111');
