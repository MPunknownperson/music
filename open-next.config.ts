import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The app is stateless (no database, no ISR cache needed), so the default
// configuration is enough for Cloudflare Workers / Pages-style deployments.
export default defineCloudflareConfig({});
