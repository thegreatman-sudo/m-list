// PIN login for staff on shared tablets. Verifies the email+PIN against the
// hashed pin stored on the staff profile, then signs the user in with the
// admin auth API using the service role. Only used by the tablet PIN screen.
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
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
    if (!email || !/^[0-9]{4,6}$/.test(pin)) {
      return new Response(JSON.stringify({ error: "Invalid email or PIN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // check_pin runs as service role (bypasses the EXECUTE revoke for anon/authed)
    const { data: profileId, error: pinErr } = await admin.rpc("check_pin", { p_email: email, p_pin: pin });
    if (pinErr) {
      console.error("check_pin failed", pinErr.message);
      return new Response(JSON.stringify({ error: "Could not verify PIN" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!profileId) {
      return new Response(JSON.stringify({ error: "Invalid email or PIN" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(profileId as string);
    if (userErr || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: "Account unavailable" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Neutral outcome for wrong pin vs unknown account: generic message above.
    const { data: session, error: sessErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email,
    });
    if (sessErr || !session?.properties?.hashed_token) {
      return new Response(JSON.stringify({ error: "Could not start session" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exchange the one-time link for a real session server-side.
    const verifyRes = await fetch(`${url}/auth/v1/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: serviceKey },
      body: JSON.stringify({
        type: "magiclink",
        token: session.properties.hashed_token.replace("hashed_token:", ""),
        email: userData.user.email,
      }),
    });
    if (!verifyRes.ok) {
      return new Response(JSON.stringify({ error: "Could not start session" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const verified = await verifyRes.json();
    const accessToken = verified?.access_token;
    const refreshToken = verified?.refresh_token;
    if (!accessToken || !refreshToken) {
      return new Response(JSON.stringify({ error: "Could not start session" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
