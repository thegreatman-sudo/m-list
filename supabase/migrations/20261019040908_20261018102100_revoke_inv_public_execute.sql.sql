/*
# Revoke inv_* EXECUTE from PUBLIC (anon inherits PUBLIC)

The previous migration revoked from `anon` explicitly, but anon inherits the
PUBLIC role and the functions were granted to PUBLIC (`=X/postgres`), so anon
still had EXECUTE. This revokes from PUBLIC itself, which removes anon's
access. authenticated and service_role keep their explicit grants.
*/
REVOKE EXECUTE ON FUNCTION public.inv_record_purchase(uuid, uuid, uuid, numeric, bigint, text, date, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_adjust_stock(uuid, uuid, uuid, numeric, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_log_waste(uuid, uuid, uuid, uuid, numeric, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_produce_batch(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_next_po_number(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_seed_sample_data(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_approve_count(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_post_goods_receipt(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_transfer_send(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_transfer_receive(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_deduct_order_item(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_reverse_order_item(uuid, boolean, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_recompute_auto_sold_out(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_get_settings(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_recipe_needs(uuid, numeric, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_assert_staff(uuid, text[]) FROM PUBLIC;
