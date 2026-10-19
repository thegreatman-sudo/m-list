// Provision a new tenant right after signup. Called once from the onboarding
// flow by an authenticated owner. Runs the idempotent create_tenant_for_owner
// RPC (service role), which creates tenant + first outlet + owner profile +
// 14-day trial. Calling it twice for the same user returns the same tenant.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const restaurantName = typeof body?.restaurantName === "string" ? body.restaurantName.trim() : "";
    const ownerName = typeof body?.ownerName === "string" ? body.ownerName.trim() : "";
    const country = typeof body?.country === "string" ? body.country.trim().slice(0, 2).toUpperCase() : "ID";

    if (!restaurantName) {
      return new Response(JSON.stringify({ error: "Restaurant name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller's JWT with the anon-key client so we trust the user id.
    const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Run the idempotent provisioning RPC as service role.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: tenantId, error: rpcErr } = await admin.rpc("create_tenant_for_owner", {
      p_user_id: userId,
      p_restaurant_name: restaurantName,
      p_owner_name: ownerName,
      p_country: country,
    });

    if (rpcErr || !tenantId) {
      console.error("create_tenant_for_owner failed", rpcErr?.message);
      return new Response(JSON.stringify({ error: "Could not create restaurant workspace" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        tenantId: tenantId,
        redirectTo: `/onboarding?tenant=${tenantId}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("create-tenant error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
