// Refunds a payment via Midtrans using the tenant's own keys.
// Called by managers/owners from the POS. Supports partial or full refunds.
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

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller's JWT and role
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
    const amount = typeof body?.amount === "number" ? body.amount : null; // null = full refund
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (!paymentId) {
      return new Response(JSON.stringify({ error: "paymentId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!reason) {
      return new Response(JSON.stringify({ error: "Reason is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Get the payment record
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .select("id, tenant_id, order_id, gross_amount, status, transaction_id, payment_type")
      .eq("id", paymentId)
      .maybeSingle();

    if (payErr || !payment) {
      return new Response(JSON.stringify({ error: "Payment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (payment.status !== "completed") {
      return new Response(JSON.stringify({ error: "Only completed payments can be refunded" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the user is owner/manager of this tenant
    const { data: profile } = await admin
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!profile || profile.tenant_id !== payment.tenant_id || !["owner", "manager"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Only owners or managers can issue refunds" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load tenant's payment settings
    const { data: settings } = await admin
      .from("payment_provider_settings")
      .select("environment, server_key_encrypted")
      .eq("tenant_id", payment.tenant_id)
      .maybeSingle();

    if (!settings || !settings.server_key_encrypted) {
      return new Response(JSON.stringify({ error: "Payment provider not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt server key
    const { data: decryptedKey, error: decErr } = await admin.rpc("decrypt_server_key", {
      p_encrypted: settings.server_key_encrypted,
    });
    if (decErr || !decryptedKey) {
      return new Response(JSON.stringify({ error: "Configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const serverKey = decryptedKey as string;
    const isProduction = settings.environment === "production";

    // Call Midtrans refund API
    const refundUrl = isProduction
      ? `https://api.midtrans.com/v2/${payment.order_id}/refund`
      : `https://api.sandbox.midtrans.com/v2/${payment.order_id}/refund`;

    const refundBody: Record<string, unknown> = { reason };
    if (amount && amount < payment.gross_amount) {
      refundBody.amount = amount;
    }

    const refundRes = await fetch(refundUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(serverKey + ":")}`,
      },
      body: JSON.stringify(refundBody),
    });

    const refundData = await refundRes.json().catch(() => ({}));

    if (!refundRes.ok) {
      const errMsg = refundData?.error_messages?.[0] || `Refund failed (${refundRes.status})`;
      // Check if the method doesn't support refunds
      if (refundData?.error_messages?.some((m: string) => m.includes("not supported") || m.includes("cannot be refunded"))) {
        return new Response(JSON.stringify({
          error: `${payment.payment_type || "This payment method"} does not support refunds through Midtrans. Please process the refund manually.`,
        }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update payment status
    const refundAmount = amount || payment.gross_amount;
    await admin.from("payments").update({
      status: refundAmount < payment.gross_amount ? "refunded" : "refunded",
      raw_response: refundData,
    }).eq("id", payment.id);

    return new Response(JSON.stringify({
      ok: true,
      refundId: refundData.refund_key,
      amount: refundAmount,
      status: refundData.transaction_status,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("midtrans-refund error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
