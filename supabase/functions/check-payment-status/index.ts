// Checks payment status from Midtrans as a fallback after the Snap popup closes.
// Works for both platform (subscription) and tenant (bill) payments.
// Fetches the status from Midtrans GET /v2/{order_id}/status and updates the record.
// verify_jwt = false: called from both authed (billing) and unauthed (guest) contexts.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function mapStatus(transactionStatus: string, fraudStatus?: string): string {
  if (transactionStatus === "settlement") return "PAID";
  if (transactionStatus === "capture" && fraudStatus === "accept") return "PAID";
  if (transactionStatus === "pending") return "PENDING";
  if (transactionStatus === "deny" || transactionStatus === "cancel" || transactionStatus === "expire") return "FAILED";
  if (transactionStatus === "refund" || transactionStatus === "partial_refund") return "REFUNDED";
  return "PENDING";
}

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
    const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
    const flow = typeof body?.flow === "string" ? body.flow.trim() : "subscription";

    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    let serverKey: string | undefined;
    let isProduction = false;
    let tenantId: string | null = null;

    if (flow === "subscription") {
      serverKey = Deno.env.get("MIDTRANS_PLATFORM_SERVER_KEY");
      isProduction = Deno.env.get("MIDTRANS_PLATFORM_IS_PRODUCTION") === "true";
    } else if (flow === "bill") {
      tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "tenantId is required for bill flow" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Load tenant's payment settings
      const { data: settings } = await admin
        .from("payment_provider_settings")
        .select("environment, server_key_encrypted")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!settings || !settings.server_key_encrypted) {
        return new Response(JSON.stringify({ error: "Payment provider not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      isProduction = settings.environment === "production";

      // Decrypt the server key via RPC
      const { data: decryptedKey, error: decErr } = await admin.rpc("decrypt_server_key", {
        p_encrypted: settings.server_key_encrypted,
      });
      if (decErr || !decryptedKey) {
        console.error("Failed to decrypt server key", decErr?.message);
        return new Response(JSON.stringify({ error: "Could not load payment configuration" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      serverKey = decryptedKey;
    } else {
      return new Response(JSON.stringify({ error: "Invalid flow (use 'subscription' or 'bill')" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!serverKey) {
      return new Response(JSON.stringify({ error: "Server key not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Midtrans status API
    const statusUrl = isProduction
      ? `https://api.midtrans.com/v2/${orderId}/status`
      : `https://api.sandbox.midtrans.com/v2/${orderId}/status`;

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Basic ${btoa(serverKey + ":")}` },
    });

    const statusData = await statusRes.json().catch(() => ({}));

    if (!statusRes.ok) {
      console.error("Midtrans status check failed", statusRes.status, JSON.stringify(statusData));
      return new Response(JSON.stringify({
        error: statusData?.error_messages?.[0] || `Status check failed (${statusRes.status})`,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mappedStatus = mapStatus(statusData.transaction_status, statusData.fraud_status);

    // Update the appropriate record
    if (flow === "subscription") {
      const { data: invoice } = await admin
        .from("invoices")
        .select("id, status")
        .eq("order_id", orderId)
        .maybeSingle();

      if (invoice && invoice.status !== "paid") {
        if (mappedStatus === "PAID") {
          const now = new Date();
          await admin.from("invoices").update({
            status: "paid",
            paid_at: now.toISOString(),
          }).eq("id", invoice.id);
        } else if (mappedStatus === "FAILED") {
          await admin.from("invoices").update({ status: "failed" }).eq("id", invoice.id);
        }
      }
    } else {
      const { data: payment } = await admin
        .from("payments")
        .select("id, status")
        .eq("order_id", orderId)
        .maybeSingle();

      if (payment && payment.status !== "completed") {
        if (mappedStatus === "PAID") {
          await admin.from("payments").update({
            status: "completed",
            payment_type: statusData.payment_type,
            transaction_id: statusData.transaction_id,
            raw_response: statusData,
            paid_at: new Date().toISOString(),
          }).eq("id", payment.id);
        } else if (mappedStatus === "FAILED") {
          await admin.from("payments").update({
            status: "failed",
            raw_response: statusData,
          }).eq("id", payment.id);
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      orderId,
      midtransStatus: statusData.transaction_status,
      mappedStatus,
      paymentType: statusData.payment_type,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("check-payment-status error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
