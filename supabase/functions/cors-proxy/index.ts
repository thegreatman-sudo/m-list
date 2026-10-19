// CORS proxy: fetches an allowlisted external URL server-side and returns it
// with permissive CORS headers so the browser can read cross-origin resources.
// JWT-protected to prevent open-proxy / SSRF abuse.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Hosts this proxy is allowed to reach. Add external integrations here.
const ALLOWED_HOSTS = new Set<string>([
  "api.pexels.com",
  "images.pexels.com",
]);

const BLOCKED_HOSTS = new Set<string>([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // cloud metadata endpoints
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // Require a valid Supabase session (JWT) to prevent open-proxy abuse.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: "Unauthorized" });
  }

  let targetUrl: string | undefined;
  if (req.method === "GET") {
    targetUrl = new URL(req.url).searchParams.get("url") ?? undefined;
  } else {
    const body = await req.json().catch(() => null);
    targetUrl = typeof body?.url === "string" ? body.url : undefined;
  }

  if (!targetUrl) return json(400, { error: "Missing url" });

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return json(400, { error: "Invalid url" });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return json(400, { error: "Unsupported protocol" });
  }
  if (BLOCKED_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith(".internal")) {
    return json(403, { error: "Host not allowed" });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return json(403, { error: "Host not allowed" });
  }

  try {
    const upstream = await fetch(parsed, {
      method: req.method,
      headers: { "Accept": "application/json, image/*, */*" },
      redirect: "follow",
    });
    const contentType = upstream.headers.get("Content-Type") ?? "application/octet-stream";
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": contentType },
    });
  } catch {
    return json(502, { error: "Upstream fetch failed" });
  }
});
