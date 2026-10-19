// Midtrans webhook handler for tenant bill payments (Flow 2).
// Looks up the tenant from the query param, loads that tenant's server key,
// verifies the signature, then double-checks by calling GET /v2/{order_id}/status.
// On PAID: saves the payment record, marks the bill as paid, closes the session.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function hexSha512(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-512", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

    // Extract tenant ID from query param
    const reqUrl = new URL(req.url);
    const tenantId = reqUrl.searchParams.get("tenant");

    if (!tenantId) {
      return new Response(JSON.stringify({ error: "Missing tenant parameter" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Load tenant's payment settings
    const { data: settings } = await admin
      .from("payment_provider_settings")
      .select("environment, server_key_encrypted")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!settings || !settings.server_key_encrypted) {
      console.error("Payment settings not found for tenant:", tenantId);
      return new Response(JSON.stringify({ error: "Payment provider not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt server key
    const { data: decryptedKey, error: decErr } = await admin.rpc("decrypt_server_key", {
      p_encrypted: settings.server_key_encrypted,
    });
    if (decErr || !decryptedKey) {
      console.error("Failed to decrypt server key", decErr?.message);
      return new Response(JSON.stringify({ error: "Configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const serverKey = decryptedKey as string;

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = body.order_id ?? "";
    const statusCode = body.status_code ?? "";
    const grossAmount = body.gross_amount ?? "";
    const receivedSignature = body.signature_key ?? "";

    // Verify signature
    const expectedSignature = await hexSha512(orderId + statusCode + grossAmount + serverKey);
    const signatureValid = expectedSignature === receivedSignature;

    // Log the raw webhook
    await admin.from("webhook_logs").insert({
      tenant_id: tenantId,
      source: "tenant",
      order_id: orderId,
      raw_payload: body,
      signature_valid: signatureValid,
      processed_at: new Date().toISOString(),
    });

    if (!signatureValid) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Double-check by calling GET /v2/{order_id}/status
    const isProduction = settings.environment === "production";
    const statusUrl = isProduction
      ? `https://api.midtrans.com/v2/${orderId}/status`
      : `https://api.sandbox.midtrans.com/v2/${orderId}/status`;

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Basic ${btoa(serverKey + ":")}` },
    });
    const statusData = await statusRes.json().catch(() => ({}));
    const mappedStatus = mapStatus(statusData.transaction_status, statusData.fraud_status);

    // Find the payment record
    const { data: payment } = await admin
      .from("payments")
      .select("id, bill_id, status, split_ref, gross_amount")
      .eq("order_id", orderId)
      .maybeSingle();

    if (!payment) {
      console.error("Payment not found for order_id:", orderId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: skip if already completed
    if (payment.status === "completed" && mappedStatus === "PAID") {
      return new Response(JSON.stringify({ ok: true, message: "Already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mappedStatus === "PAID") {
      const now = new Date().toISOString();
      await admin.from("payments").update({
        status: "completed",
        payment_type: statusData.payment_type,
        transaction_id: statusData.transaction_id,
        raw_response: statusData,
        paid_at: now,
      }).eq("id", payment.id);

      // Check if the bill is fully paid (sum of completed payments >= bill total)
      const { data: bill } = await admin
        .from("bills")
        .select("id, total_minor, session_id, table_id")
        .eq("id", payment.bill_id)
        .maybeSingle();

      if (bill) {
        const { data: allPayments } = await admin
          .from("payments")
          .select("amount_minor, status")
          .eq("bill_id", bill.id)
          .eq("status", "completed");

        const totalPaid = (allPayments || []).reduce((sum: number, p: { amount_minor: number }) => sum + p.amount_minor, 0);

        if (totalPaid >= bill.total_minor) {
          // Bill fully paid — close the bill and session, set table to cleaning
          await admin.from("bills").update({
            status: "paid",
            closed_at: now,
            updated_at: now,
          }).eq("id", bill.id);

          await admin.from("table_sessions").update({
            status: "closed",
            closed_at: now,
            updated_at: now,
          }).eq("id", bill.session_id);

          await admin.from("tables").update({
            status: "cleaning",
            updated_at: now,
          }).eq("id", bill.table_id);
        }
      }

      // Send receipt email if customer provided contact
      try {
        const customerEmail = body.customer_details?.email || statusData.customer_details?.email;
        if (customerEmail) {
          await fetch(`${url}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              kind: "receipt",
              to: customerEmail,
              tenantId,
              orderNumber: orderId,
              total: `Rp ${grossAmount}`,
            }),
          });
        }
      } catch (e) {
        console.error("Failed to send receipt", e);
      }
    } else if (mappedStatus === "FAILED") {
      await admin.from("payments").update({
        status: "failed",
        raw_response: statusData,
      }).eq("id", payment.id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("midtrans-webhook-tenant error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
