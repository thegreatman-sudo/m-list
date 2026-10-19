// Midtrans webhook handler for platform subscription payments (Flow 1).
// Verifies the signature, maps the status, and updates the invoice + tenant.
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

    const serverKey = Deno.env.get("MIDTRANS_PLATFORM_SERVER_KEY");
    if (!serverKey) {
      console.error("MIDTRANS_PLATFORM_SERVER_KEY not configured");
      return new Response(JSON.stringify({ error: "Server key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Verify signature: SHA512(order_id + status_code + gross_amount + serverKey)
    const expectedSignature = await hexSha512(orderId + statusCode + grossAmount + serverKey);
    const signatureValid = expectedSignature === receivedSignature;

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Log the raw webhook
    await admin.from("webhook_logs").insert({
      source: "platform",
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

    // Return 200 quickly (Midtrans expects fast response)
    // Process asynchronously
    const mappedStatus = mapStatus(body.transaction_status, body.fraud_status);

    // Find the invoice by order_id
    const { data: invoice } = await admin
      .from("invoices")
      .select("id, tenant_id, plan, interval, status, period_start, period_end")
      .eq("order_id", orderId)
      .maybeSingle();

    if (!invoice) {
      console.error("Invoice not found for order_id:", orderId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: skip if already processed
    if (invoice.status === "paid" && mappedStatus === "PAID") {
      return new Response(JSON.stringify({ ok: true, message: "Already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mappedStatus === "PAID") {
      const now = new Date();
      const periodEnd = new Date(now);
      if (invoice.interval === "yearly") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      // Mark invoice paid
      await admin.from("invoices").update({
        status: "paid",
        paid_at: now.toISOString(),
      }).eq("id", invoice.id);

      // Update tenant: plan, status active, period end
      await admin.from("tenants").update({
        plan: invoice.plan,
        status: "active",
        updated_at: now.toISOString(),
      }).eq("id", invoice.tenant_id);

      // Update subscription record
      const { data: existingSub } = await admin
        .from("subscriptions")
        .select("id")
        .eq("tenant_id", invoice.tenant_id)
        .maybeSingle();

      if (existingSub) {
        await admin.from("subscriptions").update({
          plan: invoice.plan,
          billing_cycle: invoice.interval,
          status: "active",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          updated_at: now.toISOString(),
        }).eq("id", existingSub.id);
      } else {
        await admin.from("subscriptions").insert({
          tenant_id: invoice.tenant_id,
          plan: invoice.plan,
          billing_cycle: invoice.interval,
          status: "active",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        });
      }

      // Send receipt email (fire and forget)
      try {
        const { data: tenant } = await admin.from("tenants")
          .select("name, owner_user_id").eq("id", invoice.tenant_id).maybeSingle();
        const { data: profile } = await admin.from("profiles")
          .select("email, full_name").eq("id", tenant?.owner_user_id).maybeSingle();

        if (profile?.email) {
          await fetch(`${url}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              kind: "receipt",
              to: profile.email,
              tenantId: invoice.tenant_id,
              restaurantName: tenant?.name,
              ownerName: profile.full_name,
              orderNumber: orderId,
            }),
          });
        }
      } catch (e) {
        console.error("Failed to send receipt email", e);
      }
    } else if (mappedStatus === "FAILED") {
      await admin.from("invoices").update({ status: "failed" }).eq("id", invoice.id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("midtrans-webhook-platform error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
