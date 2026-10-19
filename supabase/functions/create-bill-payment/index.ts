// Creates a Snap transaction for bill payments (Flow 2).
// The restaurant customer pays for their meal using the restaurant's own
// Midtrans account. The server recalculates the amount from the database
// and never trusts a total sent by the browser.
// verify_jwt = false: called from the guest QR page without auth.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CartLine {
  name: string;
  quantity: number;
  unit_price_minor: number;
  modifiers: { name: string; price_delta_minor: number }[];
  notes?: string | null;
  status: string;
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
    const sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken.trim() : "";
    const tipMinor = typeof body?.tipMinor === "number" ? body.tipMinor : 0;
    const splitMode = typeof body?.splitMode === "string" ? body.splitMode : "full"; // full | equal | amount
    const splitValue = typeof body?.splitValue === "number" ? body.splitValue : null;
    const customerName = typeof body?.customerName === "string" ? body.customerName.trim().slice(0, 100) : null;
    const customerPhone = typeof body?.customerPhone === "string" ? body.customerPhone.trim().slice(0, 20) : null;

    if (!sessionToken || sessionToken.length < 8) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Find the table + outlet + session from the qr_token
    const { data: tableData, error: tableErr } = await admin
      .from("tables")
      .select("id, outlet_id, tenant_id, label")
      .eq("qr_token", sessionToken)
      .maybeSingle();

    if (tableErr || !tableData) {
      return new Response(JSON.stringify({ error: "Table not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load tenant payment settings
    const { data: settings, error: settingsErr } = await admin
      .from("payment_provider_settings")
      .select("environment, client_key, server_key_encrypted, enabled_methods, is_active")
      .eq("tenant_id", tableData.tenant_id)
      .maybeSingle();

    if (settingsErr || !settings || !settings.is_active || !settings.server_key_encrypted) {
      return new Response(JSON.stringify({
        ok: true,
        notConfigured: true,
        message: "Pay at the counter or ask the waiter",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt the server key
    const { data: decryptedKey, error: decErr } = await admin.rpc("decrypt_server_key", {
      p_encrypted: settings.server_key_encrypted,
    });
    if (decErr || !decryptedKey) {
      console.error("Failed to decrypt server key", decErr?.message);
      return new Response(JSON.stringify({ error: "Payment configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const serverKey = decryptedKey as string;

    // Get the open session
    const { data: session } = await admin
      .from("table_sessions")
      .select("id, outlet_id")
      .eq("table_id", tableData.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ error: "No active session for this table" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the open bill
    const { data: bill } = await admin
      .from("bills")
      .select("id, subtotal_minor, tax_minor, service_minor, total_minor, status")
      .eq("session_id", session.id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!bill) {
      return new Response(JSON.stringify({ error: "No open bill found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all order items for this session (non-voided)
    const { data: orders } = await admin
      .from("orders")
      .select("id")
      .eq("session_id", session.id);

    if (!orders || orders.length === 0) {
      return new Response(JSON.stringify({ error: "Nothing to pay" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderIds = orders.map((o: { id: string }) => o.id);
    const { data: items } = await admin
      .from("order_items")
      .select("name, quantity, unit_price_minor, modifiers, notes, status, station")
      .in("order_id", orderIds)
      .neq("status", "voided")
      .neq("status", "rejected");

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "Nothing to pay" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Recalculate the total from the database (never trust the browser)
    let subtotalMinor = 0;
    const itemDetails: { id: string; name: string; price: number; quantity: number; category?: string }[] = [];

    for (const item of items as CartLine[]) {
      let lineTotal = item.unit_price_minor * item.quantity;
      const modNames: string[] = [];
      for (const mod of item.modifiers || []) {
        lineTotal += mod.price_delta_minor * item.quantity;
        modNames.push(mod.name);
      }
      subtotalMinor += lineTotal;
      const itemName = modNames.length > 0
        ? `${item.name} (${modNames.join(", ")})`
        : item.name;
      itemDetails.push({
        id: `${item.name.slice(0, 20)}_${item.quantity}`,
        name: itemName.slice(0, 50),
        price: Math.floor(lineTotal / item.quantity),
        quantity: item.quantity,
        category: "Food & Beverage",
      });
    }

    // Get outlet for tax and service charge
    const { data: outlet } = await admin
      .from("outlets")
      .select("tax_percent, service_charge_percent, name, tenant_id")
      .eq("id", tableData.outlet_id)
      .maybeSingle();

    const taxPercent = outlet?.tax_percent || 0;
    const servicePercent = outlet?.service_charge_percent || 0;
    const taxMinor = Math.round((subtotalMinor * taxPercent) / 100);
    const serviceMinor = Math.round((subtotalMinor * servicePercent) / 100);

    // Add tax, service, and tip as separate lines
    if (taxMinor > 0) {
      itemDetails.push({ id: "tax", name: `Tax (${taxPercent}%)`, price: taxMinor, quantity: 1, category: "Tax" });
    }
    if (serviceMinor > 0) {
      itemDetails.push({ id: "service", name: `Service Charge (${servicePercent}%)`, price: serviceMinor, quantity: 1, category: "Service" });
    }
    if (tipMinor > 0) {
      itemDetails.push({ id: "tip", name: "Tip", price: tipMinor, quantity: 1, category: "Tip" });
    }

    let grossAmount = subtotalMinor + taxMinor + serviceMinor + tipMinor;

    // Handle split payments
    let splitRef = "full";
    if (splitMode === "equal" && splitValue && splitValue > 1) {
      const perPerson = Math.floor(grossAmount / splitValue);
      grossAmount = perPerson;
      splitRef = `equal-${splitValue}`;
    } else if (splitMode === "amount" && splitValue && splitValue > 0) {
      grossAmount = splitValue;
      splitRef = `amount-${splitValue}`;
    }

    if (grossAmount < 1) {
      return new Response(JSON.stringify({ error: "Amount too small" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shortBillId = bill.id.slice(0, 8);
    const orderId = `BILL-${shortBillId}-${Date.now()}`;
    const isProduction = settings.environment === "production";

    // Create a payment record
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        tenant_id: tableData.tenant_id,
        bill_id: bill.id,
        split_ref: splitRef,
        order_id: orderId,
        gross_amount: grossAmount,
        method: "midtrans",
        amount_minor: grossAmount,
        status: "pending",
      })
      .select("id")
      .single();

    if (payErr || !payment) {
      console.error("Failed to create payment record", payErr?.message);
      return new Response(JSON.stringify({ error: "Could not create payment" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build Snap transaction
    const snapUrl = isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    // Map enabled_methods to Midtrans payment methods
    const methodMap: Record<string, string> = {
      credit_card: "credit_card",
      gopay: "gopay",
      shopeepay: "shopeepay",
      qris: "qris",
      bank_transfer: "bank_transfer",
    };
    const enabledPayments = (settings.enabled_methods || ["qris", "gopay", "credit_card"])
      .map((m: string) => methodMap[m])
      .filter(Boolean);

    const snapBody = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      item_details: itemDetails,
      customer_details: {
        first_name: customerName || "Guest",
        phone: customerPhone || undefined,
      },
      enabled_payments: enabledPayments.length > 0 ? enabledPayments : undefined,
      expiry: {
        duration: 15,
        unit: "minutes",
      },
    };

    // Set the override notification URL so this restaurant's webhooks reach our handler
    const notificationUrl = `${url}/functions/v1/midtrans-webhook-tenant?tenant=${tableData.tenant_id}`;

    const snapRes = await fetch(snapUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(serverKey + ":")}`,
        "X-Override-Notification": notificationUrl,
      },
      body: JSON.stringify(snapBody),
    });

    const snapData = await snapRes.json().catch(() => ({}));

    if (!snapRes.ok) {
      console.error("Midtrans Snap error", snapRes.status, JSON.stringify(snapData));
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return new Response(JSON.stringify({
        error: snapData?.error_messages?.[0] || `Midtrans error (${snapRes.status})`,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      paymentId: payment.id,
      orderId,
      grossAmount,
      clientKey: settings.client_key,
      snapToken: snapData.token,
      isProduction,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-bill-payment error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
