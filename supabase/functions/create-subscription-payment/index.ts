// Creates a Snap transaction for subscription payments (Flow 1).
// The restaurant owner pays MenuList for their plan using the platform's
// Midtrans account. Creates an invoice record, then calls Midtrans Snap API
// to get a token. Returns the token + client key to the browser.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PLAN_PRICES: Record<string, { monthly: number; yearly: number; name: string }> = {
  starter: { monthly: 199000, yearly: 1990000, name: "Starter" },
  growth: { monthly: 499000, yearly: 4990000, name: "Growth" },
  chain: { monthly: 1299000, yearly: 12990000, name: "Chain" },
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

    // Verify the caller's JWT
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
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const planId = typeof body?.plan === "string" ? body.plan.trim() : "";
    const interval = typeof body?.interval === "string" ? body.interval.trim() : "monthly";

    if (!planId || !PLAN_PRICES[planId]) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (interval !== "monthly" && interval !== "yearly") {
      return new Response(JSON.stringify({ error: "Invalid billing interval" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Get the tenant for this user
    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id, name, owner_user_id, currency_code")
      .eq("owner_user_id", userId)
      .maybeSingle();

    if (tenantErr || !tenant) {
      return new Response(JSON.stringify({ error: "No restaurant found for your account" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get owner profile for customer details
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();

    const planConfig = PLAN_PRICES[planId];
    const amount = interval === "yearly" ? planConfig.yearly : planConfig.monthly;
    const shortTenantId = tenant.id.slice(0, 8);
    const orderId = `SUB-${shortTenantId}-${Date.now()}`;
    const periodStart = new Date();
    const periodEnd = new Date();
    if (interval === "yearly") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Create the invoice record
    const { data: invoice, error: invoiceErr } = await admin
      .from("invoices")
      .insert({
        tenant_id: tenant.id,
        plan: planId,
        interval: interval,
        amount_minor: amount,
        currency: "IDR",
        status: "open",
        order_id: orderId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
      })
      .select("id")
      .single();

    if (invoiceErr || !invoice) {
      console.error("Failed to create invoice", invoiceErr?.message);
      return new Response(JSON.stringify({ error: "Could not create invoice" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read platform Midtrans keys from secrets
    const serverKey = Deno.env.get("MIDTRANS_PLATFORM_SERVER_KEY");
    const clientKey = Deno.env.get("MIDTRANS_PLATFORM_CLIENT_KEY");
    const isProduction = Deno.env.get("MIDTRANS_PLATFORM_IS_PRODUCTION") === "true";

    if (!serverKey || !clientKey) {
      // Keys not configured — return sandbox simulation info
      return new Response(JSON.stringify({
        ok: true,
        notConfigured: true,
        invoiceId: invoice.id,
        orderId,
        amount,
        clientKey: null,
        snapToken: null,
        message: "Midtrans keys not configured. Use the simulate button to test.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the Snap transaction request
    const snapUrl = isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    const snapBody = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      item_details: [
        {
          id: planId,
          name: `MenuList ${planConfig.name} (${interval})`,
          price: amount,
          quantity: 1,
          brand: "MenuList",
          category: "Software Subscription",
          merchant_name: "MenuList",
        },
      ],
      customer_details: {
        first_name: profile?.full_name || "Owner",
        email: profile?.email || userData.user.email || "",
      },
      enabled_payments: ["credit_card", "gopay", "shopeepay", "qris", "bank_transfer", "echannel"],
      expiry: {
        duration: 1,
        unit: "days",
      },
    };

    const snapRes = await fetch(snapUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(serverKey + ":")}`,
      },
      body: JSON.stringify(snapBody),
    });

    const snapData = await snapRes.json().catch(() => ({}));

    if (!snapRes.ok) {
      console.error("Midtrans Snap error", snapRes.status, JSON.stringify(snapData));
      await admin.from("invoices").update({ status: "failed" }).eq("id", invoice.id);
      return new Response(JSON.stringify({
        error: snapData?.error_messages?.[0] || `Midtrans error (${snapRes.status})`,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save the snap token on the invoice
    await admin.from("invoices").update({ snap_token: snapData.token }).eq("id", invoice.id);

    return new Response(JSON.stringify({
      ok: true,
      invoiceId: invoice.id,
      orderId,
      amount,
      clientKey,
      snapToken: snapData.token,
      isProduction,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-subscription-payment error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
