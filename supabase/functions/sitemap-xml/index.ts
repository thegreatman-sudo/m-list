// Sitemap for the marketing site (single-page app; routes are client-rendered)
// plus one entry per published restaurant website served at /r/:slug.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey",
};

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string),
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const origin = new URL(req.url).origin;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );

  const { data: outlets, error } = await supabase
    .from("outlets")
    .select("website_slug, updated_at")
    .eq("website_published", true)
    .not("website_slug", "is", null);

  if (error) {
    return new Response("Could not build sitemap", { status: 500, headers: corsHeaders });
  }

  const today = new Date().toISOString().slice(0, 10);

  const staticRoutes = ["/", "/pricing", "/signup", "/login"];
  const staticEntries = staticRoutes.map(
    (p) => `  <url><loc>${xmlEscape(`${origin}${p}`)}</loc><lastmod>${today}</lastmod></url>`,
  );

  const outletEntries = (outlets ?? []).map((o) => {
    const loc = `${origin}/r/${xmlEscape(encodeURIComponent(o.website_slug ?? ""))}`;
    const lastmod = (o.updated_at ?? today).slice(0, 10);
    return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
  });

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...staticEntries, ...outletEntries].join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", ...corsHeaders },
  });
});
