// Resolves a QR table token when a guest scans a code. Validates the token
// server-side, rate-limits per IP, and returns the outlet info + menu without
// exposing any internal IDs. Also finds or creates the open table session
// (only if the outlet is currently open). The guest receives an opaque
// sessionToken (the qr_token itself, which is already an unguessable secret)
// instead of internal UUIDs.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const RATE_LIMIT_WINDOW_MINUTES = 1;
const RATE_LIMIT_MAX_REQUESTS = 30;

function getClientIP(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim();
  if (ip) return ip;
  return req.headers.get("x-real-ip") ?? "unknown";
}

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
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length < 8) {
      return new Response(JSON.stringify({ error: "Invalid table code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // --- Rate limiting per IP ---
    const ip = getClientIP(req);
    const rateKey = `resolve-table-token:${ip}`;
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

    // Try to increment existing counter if within window
    const { data: existing } = await admin
      .from("rate_limits")
      .select("count, window_start")
      .eq("key", rateKey)
      .maybeSingle();

    let count: number;
    if (existing && new Date(existing.window_start) > new Date(windowStart)) {
      // Within window — increment
      count = existing.count + 1;
      if (count > RATE_LIMIT_MAX_REQUESTS) {
        return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await admin.from("rate_limits").update({ count, updated_at: new Date().toISOString() }).eq("key", rateKey);
    } else {
      // New window or expired — reset
      count = 1;
      await admin.from("rate_limits").upsert({
        key: rateKey,
        count,
        window_start: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }

    // --- Resolve the token via RPC ---
    const { data: result, error: rpcErr } = await admin.rpc("resolve_table_token", {
      p_token: token,
    });

    if (rpcErr) {
      const msg = rpcErr.message;
      if (msg.includes("Table not found") || msg.includes("Invalid table code")) {
        return new Response(JSON.stringify({ error: "This table code is not valid." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("Outlet not found")) {
        return new Response(JSON.stringify({ error: "This restaurant is no longer available." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("resolve_table_token failed", msg);
      return new Response(JSON.stringify({ error: "Could not resolve table code" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!result) {
      return new Response(JSON.stringify({ error: "Table not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If the outlet is closed, return a 200 with is_open=false so the guest
    // can browse the menu but cannot order.
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("resolve-table-token error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
