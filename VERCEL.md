# Deploy the customer gateway and portal on Vercel

This is the customer-key/postgreSQL hosted gateway, including the V6 billing and tool-session fixes. The separate local Express/OpenRouter gateway at D:/local-ai-gateway remains unchanged. Blender and Claude Code continue to run on each customer's computer.

Vercel restricts Hobby to personal, non-commercial use. Selling customer API keys requires an eligible commercial plan such as Pro: https://vercel.com/docs/limits/fair-use-guidelines

## Import

Upload this complete source to the root of your GitHub repository. Import that repository in Vercel. Choose Framework Preset Other, Root Directory the directory containing vercel.json (repository root for this ZIP), Node.js 22.x. The checked-in configuration sets Install Command npm ci, Build Command npm run build:vercel, and Output Directory public. Leave those settings as configured; do not set Output Directory to the repository root.

## Production environment variables

Set DATABASE_URL to the verified TLS connection string of your hosted PostgreSQL database (prefer its pooled connection endpoint), ADMIN_ACCESS_KEY to your existing administrator key, DEEPSEEK_API_KEY to your existing provider key, and INFERENCE_ENABLED to true. CREDIT_POLICY is optional; if set, use deepseek-flash-cost-v1. Never prefix any of these with NEXT_PUBLIC_ or put them in public files.

PUBLIC_ORIGIN is optional: the build automatically uses VERCEL_PROJECT_PRODUCTION_URL for Production and VERCEL_URL for Preview. Enable Vercel's automatic system environment variables. For a custom domain, PUBLIC_ORIGIN may explicitly be https://your-domain.example, with no path. Do not carry over https://apily.netlify.app. The build regenerates customer ZIPs and checksums for the selected origin. Set PUBLIC_ORIGIN only for Production if previews should target their own domains. Rebuild after changing your domain.

Apply schema.sql to your hosted database if its latest migrations are not already present. Uploading schema.sql does not execute it. This Vercel adaptation adds no database migration beyond V6.

Keep Preview provider calls disabled or use isolated Preview keys/database. Production customer API traffic needs a public Production domain; a Vercel login/protection page cannot be used by the CLI. Database and customer-key authentication still apply.

## Verify the actual deployment

1. Open /api/health: expect service apiduck, release vercel-v1, and the deployed Git commit.
2. Open / and /admin. Sign in with your admin key, then use an existing funded customer key in the customer portal.
3. Download a new connector from this Vercel site. Its gateway-url.txt must contain the Vercel/custom origin, not Netlify. Existing connectors still point to their original address.
4. Try a short text request and then one harmless file/tool operation in a new Claude Code session. Check /api/account and the portal balance. Never post keys in logs or screenshots.
5. Confirm /schema.sql, /lib/quota.mjs and /.env return 404.

The function timeout is 60 seconds; upstream generation currently has a 45-second timeout. Incoming API requests are capped at 4 MB, below Vercel's documented 4.5 MB function payload ceiling. Responses stream directly; they are not buffered until completion. Interrupted requests with uncertain provider usage retain holds rather than invent a refund. Held credits are subtracted before overlapping requests are admitted.

This setup uses four native Web Request/Response API entries plus a health entry, static public files, explicit rewrites, global security headers and explicit tokenizer assets. No server.listen() process is required in Vercel. The database is external; local files and Windows DPAPI credentials are not uploaded.

## Validation performed

63 automated tests passed, including streaming before completion, cancellation, authenticated entries, connector domain selection, large tool output and strict credit-cap behavior. All five functions packaged successfully with @vercel/node 32.0.0 for nodejs22.x, with the official tokenizer included. vercel.json passed validation against Vercel's published schema (normalizing mixed-draft exclusive bounds in unrelated experimental fields). A real Vercel deployment and its production database/provider access must still be verified in your account.

Official references:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/environment-variables/system-environment-variables
