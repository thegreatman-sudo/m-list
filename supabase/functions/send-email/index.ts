// Sends transactional emails via Resend. Supports 5 email types:
// welcome, email_verification, staff_invite, trial_ending, receipt.
// Reads the Resend API key from the RESEND_API_KEY secret.
// All sends (or failures) are logged to the email_logs table.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const RESEND_API = "https://api.resend.com/emails";
const APP_NAME = "MenuList";
const LEGACY_NAME = "DineFlow";
const APP_DOMAIN = Deno.env.get("VITE_APP_DOMAIN") || "menulist.app";
const FROM = `${APP_NAME} <noreply@${APP_DOMAIN}>`;

interface EmailPayload {
  kind: "welcome" | "email_verification" | "staff_invite" | "trial_ending" | "receipt" | "rebrand_announcement";
  to: string;
  tenantId?: string;
  // kind-specific data
  restaurantName?: string;
  ownerName?: string;
  verificationUrl?: string;
  inviteToken?: string;
  role?: string;
  trialEndsAt?: string;
  receiptHtml?: string;
  orderNumber?: number;
  total?: string;
}

function buildEmail(p: EmailPayload): { subject: string; html: string } {
  switch (p.kind) {
    case "welcome":
      return {
        subject: `Welcome to ${APP_NAME}, ${p.ownerName || "there"}!`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="color:#1c1917;">Welcome to ${APP_NAME}</h1>
<p>Hi ${p.ownerName || "there"},</p>
<p>Your restaurant <strong>${p.restaurantName || "your restaurant"}</strong> is all set. You have a 14-day free trial — no credit card required.</p>
<p>Here's what to do next:</p>
<ol>
<li>Set up your dining areas and tables</li>
<li>Build your menu with photos and prices</li>
<li>Generate QR codes for each table</li>
<li>Invite your staff</li>
</ol>
<p>Need help? Reply to this email or visit our help center.</p>
<p style="color:#78716c;font-size:14px;margin-top:32px;">— The ${APP_NAME} Team</p>
</div>`,
      };

    case "email_verification":
      return {
        subject: "Verify your email address",
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="color:#1c1917;">Verify your email</h1>
<p>Click the link below to confirm your email address:</p>
<p><a href="${p.verificationUrl || "#"}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Verify email</a></p>
<p style="color:#78716c;font-size:14px;">If you didn't create an account, you can ignore this email.</p>
</div>`,
      };

    case "staff_invite":
      return {
        subject: `You're invited to join ${p.restaurantName || "a restaurant"} on ${APP_NAME}`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="color:#1c1917;">You've been invited</h1>
<p>You've been invited to join <strong>${p.restaurantName || "a restaurant"}</strong> as a <strong>${p.role || "staff member"}</strong> on ${APP_NAME}.</p>
<p>Click the link below to accept the invitation and set up your account:</p>
<p><a href="${p.inviteToken ? `https://${APP_DOMAIN}/invite?token=` + p.inviteToken : "#"}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Accept invitation</a></p>
<p style="color:#78716c;font-size:14px;">This invitation expires in 7 days.</p>
</div>`,
      };

    case "trial_ending":
      return {
        subject: `Your ${APP_NAME} trial ends in 3 days`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="color:#1c1917;">Your trial ends in 3 days</h1>
<p>Hi ${p.ownerName || "there"},</p>
<p>Your 14-day free trial for <strong>${p.restaurantName || "your restaurant"}</strong> ends on ${p.trialEndsAt || "soon"}.</p>
<p>To keep using ${APP_NAME} without interruption, choose a plan that fits your business:</p>
<p><a href="https://${APP_DOMAIN}/billing" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Choose a plan</a></p>
<p style="color:#78716c;font-size:14px;">No credit card was required to start your trial. You'll need to add a payment method to continue.</p>
</div>`,
      };

    case "receipt":
      return {
        subject: `Receipt for order #${p.orderNumber || ""}`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="color:#1c1917;">Thank you for your order</h1>
<p>Order #${p.orderNumber || ""}</p>
${p.receiptHtml || "<p>See your order details in the app.</p>"}
${p.total ? `<p style="font-size:18px;"><strong>Total: ${p.total}</strong></p>` : ""}
<p style="color:#78716c;font-size:14px;margin-top:32px;">— ${p.restaurantName || APP_NAME}</p>
</div>`,
      };

    case "rebrand_announcement":
      return {
        subject: `${APP_NAME} is now ${APP_NAME} — same product, same login`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="color:#1c1917;">${LEGACY_NAME} is now ${APP_NAME}</h1>
<p>Hi ${p.ownerName || "there"},</p>
<p>We have renamed ${LEGACY_NAME} to <strong>${APP_NAME}</strong>. It is the same product you use every day — same features, same login, same data.</p>
<p><strong>What stays the same:</strong></p>
<ul>
<li>Your login email and password</li>
<li>Your menu, orders, reservations and staff</li>
<li>Your billing plan and invoices</li>
<li><strong>Your printed table QR codes — they keep working indefinitely. No need to reprint anything.</strong></li>
</ul>
<p>The only difference is the name you see in the app, on our website and in emails. Nothing is required from you.</p>
<p>Read the full details at <a href="https://${APP_DOMAIN}/rebrand">${APP_DOMAIN}/rebrand</a>.</p>
<p style="color:#78716c;font-size:14px;margin-top:32px;">— The ${APP_NAME} Team</p>
</div>`,
      };

    default:
      return { subject: `${APP_NAME} notification`, html: `<p>You have a notification from ${APP_NAME}.</p>` };
  }
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

    // This function should only be called with the service role key
    // (from other edge functions or server-side code), not from the browser.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (token !== serviceKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null) as EmailPayload | null;
    if (!body || !body.kind || !body.to) {
      return new Response(JSON.stringify({ error: "Missing required fields (kind, to)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validKinds = ["welcome", "email_verification", "staff_invite", "trial_ending", "receipt", "rebrand_announcement"];
    if (!validKinds.includes(body.kind)) {
      return new Response(JSON.stringify({ error: "Invalid email type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { subject, html } = buildEmail(body);
    const resendKey = Deno.env.get("RESEND_API_KEY");

    if (!resendKey) {
      // Log the queued email — it will be sent once RESEND_API_KEY is configured
      await admin.from("email_logs").insert({
        tenant_id: body.tenantId || null,
        kind: body.kind,
        recipient: body.to,
        subject,
        status: "queued",
        error: "RESEND_API_KEY not configured",
      });

      return new Response(JSON.stringify({
        ok: true,
        status: "queued",
        message: "Email queued — RESEND_API_KEY not set. The email will be sent once the key is configured.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via Resend
    const resendRes = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: body.to,
        subject,
        html,
      }),
    });

    const resendBody = await resendRes.json().catch(() => ({}));

    if (!resendRes.ok) {
      const errMsg = resendBody?.message || `Resend API error (${resendRes.status})`;
      await admin.from("email_logs").insert({
        tenant_id: body.tenantId || null,
        kind: body.kind,
        recipient: body.to,
        subject,
        status: "failed",
        error: errMsg,
      });

      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId = resendBody?.id || null;
    await admin.from("email_logs").insert({
      tenant_id: body.tenantId || null,
      kind: body.kind,
      recipient: body.to,
      subject,
      provider_message_id: messageId,
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      ok: true,
      status: "sent",
      messageId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-email error", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
