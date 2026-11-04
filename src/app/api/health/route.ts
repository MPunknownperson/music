export const dynamic = "force-dynamic";

/** Liveness probe. The app is stateless (no database) so it runs on Node or Cloudflare Workers alike. */
export function GET() {
  return Response.json({ status: "ok", service: "fret-and-key", time: new Date().toISOString() });
}
