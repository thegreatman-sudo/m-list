/*
# Inventory — surface auto sold-out on guest menu and public website

1. Plain-English explanation
When an ingredient runs out, the inventory engine flags the menu item
(auto_sold_out). This migration makes the two public menu loaders treat that
flag exactly like a manual sold-out, so guests and website visitors stop
seeing the dish. The item reappears automatically when stock is replenished
(the engine clears the flag).

2. Functions changed
- guest_get_menu: 'sold_out' now reports sold_out OR auto_sold_out.
- public_site_data: item filter now excludes auto_sold_out items too.

3. Security: grants unchanged.
4. Notes: additive change; response shape is identical.
*/

CREATE OR REPLACE FUNCTION guest_get_menu(p_token text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table tables%ROWTYPE;
  v_outlet_id uuid;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid table code';
  END IF;
  SELECT * INTO v_table FROM tables WHERE qr_token = p_token LIMIT 1;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  v_outlet_id := v_table.outlet_id;

  RETURN json_build_object(
    'categories', (
      SELECT COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'sort_order', c.sort_order)
               ORDER BY c.sort_order), '[]'::json)
      FROM menu_categories c WHERE c.outlet_id = v_outlet_id
    ),
    'items', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', i.id, 'category_id', i.category_id, 'name', i.name,
               'description', i.description, 'price_minor', i.price_minor,
               'photo_url', i.photo_url, 'station', i.station,
               'prep_time_seconds', i.prep_time_seconds, 'dietary_tags', to_json(i.dietary_tags),
               'allergens', to_json(i.allergens), 'calories', i.calories,
               'available', i.available, 'sold_out', (i.sold_out OR i.auto_sold_out), 'sort_order', i.sort_order
             ) ORDER BY i.sort_order), '[]'::json)
      FROM menu_items i WHERE i.outlet_id = v_outlet_id
    ),
    'modifiers', (
      SELECT COALESCE(json_agg(json_build_object(
               'id', m.id, 'item_id', m.item_id, 'name', m.name, 'required', m.required,
               'min_select', m.min_select, 'max_select', m.max_select, 'sort_order', m.sort_order,
               'options', (
                 SELECT COALESCE(json_agg(json_build_object(
                          'id', o.id, 'modifier_id', o.modifier_id, 'name', o.name,
                          'price_delta_minor', o.price_delta_minor,
                          'is_default', o.is_default, 'sort_order', o.sort_order
                        ) ORDER BY o.sort_order), '[]'::json)
                 FROM menu_modifier_options o WHERE o.modifier_id = m.id
               )
             ) ORDER BY m.sort_order), '[]'::json)
      FROM (
        SELECT mm.* FROM menu_modifiers mm
        JOIN menu_items mi ON mi.id = mm.item_id
        WHERE mi.outlet_id = v_outlet_id
      ) m
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public_site_data(p_slug text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_outlet outlets%ROWTYPE;
BEGIN
  IF p_slug IS NULL OR length(btrim(p_slug)) < 2 THEN
    RAISE EXCEPTION 'Site not found';
  END IF;
  SELECT * INTO v_outlet FROM outlets
  WHERE website_slug = lower(btrim(p_slug)) AND website_published = true;
  IF v_outlet.id IS NULL THEN
    RAISE EXCEPTION 'Site not found';
  END IF;
  RETURN json_build_object(
    'outlet', json_build_object(
      'name', v_outlet.name, 'website_slug', v_outlet.website_slug,
      'website_hero_title', v_outlet.website_hero_title,
      'website_tagline', v_outlet.website_tagline,
      'opening_hours', v_outlet.opening_hours,
      'logo_url', v_outlet.logo_url, 'hero_url', v_outlet.hero_url
    ),
    'menu', (
      SELECT COALESCE(json_agg(json_build_object(
               'category', c.name,
               'items', (
                 SELECT COALESCE(json_agg(json_build_object(
                          'name', i.name, 'description', i.description,
                          'price_minor', i.price_minor, 'photo_url', i.photo_url,
                          'dietary_tags', to_json(i.dietary_tags)
                        ) ORDER BY i.sort_order), '[]'::json)
                 FROM menu_items i
                 WHERE i.category_id = c.id AND i.available = true AND i.sold_out = false AND i.auto_sold_out = false
               )
             ) ORDER BY c.sort_order), '[]'::json)
      FROM menu_categories c WHERE c.outlet_id = v_outlet.id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_get_menu(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION guest_get_menu(text) TO anon;
REVOKE EXECUTE ON FUNCTION public_site_data(text) FROM anon;
GRANT EXECUTE ON FUNCTION public_site_data(text) TO anon, authenticated;
