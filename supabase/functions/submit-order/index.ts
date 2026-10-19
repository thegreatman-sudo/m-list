// Submits a guest order. Validates prices and availability on the server
// (never trusts browser-sent prices), splits the order into one ticket per
// station, and applies the outlet's approval mode. An idempotency key
// prevents duplicate orders from double-taps.
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
    const sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken.trim() : "";
    const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const lines = Array.isArray(body?.lines) ? body.lines : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) : null;
    const guestName = typeof body?.guestName === "string" ? body.guestName.trim().slice(0, 100) : null;

    if (!sessionToken || sessionToken.length < 8) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!idempotencyKey) {
      return new Response(JSON.stringify({ error: "Idempotency key is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "Your cart is empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lines.length > 50) {
      return new Response(JSON.stringify({ error: "Too many items in one order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: result, error: rpcErr } = await admin.rpc("submit_order", {
      p_token: sessionToken,
      p_idempotency_key: idempotencyKey,
      p_lines: lines,
      p_notes: notes,
      p_guest_name: guestName,
    });

    if (rpcErr) {
      const msg = rpcErr.message;
      if (msg.includes("Table not found") || msg.includes("Invalid table code")) {
        return new Response(JSON.stringify({ error: "Your session has expired. Please scan the QR code again." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("Cart is empty")) {
        return new Response(JSON.stringify({ error: "Your cart is empty" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("sold out") || msg.includes("no longer available")) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("daily") || msg.includes("left of")) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("Invalid quantity") || msg.includes("Invalid item") || msg.includes("Too many")) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("submit_order failed", msg);
      return new Response(JSON.stringify({ error: "Could not place your order. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!result) {
      return new Response(JSON.stringify({ error: "Could not place your order" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("submit-order error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
