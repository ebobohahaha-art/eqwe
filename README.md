# ApiDuck hosted gateway and customer connectors

Public origin: https://apily.netlify.app

ApiDuck provides customer-key login, an administrator portal, PostgreSQL-backed
lifetime credit balances, and a bounded Anthropic-compatible gateway to DeepSeek
Flash. ApiDuck Fast is a service alias, not an Anthropic Claude model.

## Deploy on Netlify

Upload this project's complete contents at the GitHub repository root. Leave the
base directory blank. Do not upload .env, credentials or node_modules.

- Build command: npm run build
- Publish directory: public
- Functions directory: netlify/functions
- Node version: 22

Configure server-only DATABASE_URL, ADMIN_ACCESS_KEY and DEEPSEEK_API_KEY. Apply
schema.sql to the hosted PostgreSQL database. Set INFERENCE_ENABLED=true when
enabling customer access. CREDIT_POLICY defaults to deepseek-flash-cost-v1; that
explicit value is also accepted. Redeploy after changes to Functions variables.

PROVIDER_PRICING_VERIFIED_AT and MAX_PROVIDER_REQUEST_TOKENS are no longer needed.
The server checks the official provider tariff/model automatically and enforces
request bounds itself. There is no manual ceiling or timestamp bypass. See
[CREDIT-POLICY.md](CREDIT-POLICY.md) and [REQUEST-LIMITS.md](REQUEST-LIMITS.md).

Sign into /admin with your separate administrator key to inspect Gateway setup,
create customer keys, grant credits or revoke access. Generate an admin key
privately with npm run admin-key. See [ADMIN.md](ADMIN.md).

## Customer packages

Create a separate customer for each purchase and grant 10000000 internal credits
for the $0.20 model-cost allowance. Verify the marketplace payment independently;
no payment webhook is integrated. Deliver the sk-gw customer key privately.
Balances persist across reinstalls and a copied key shares the same allowance.

Builds generate /downloads/apiduck-windows.zip, /downloads/apiduck-linux.zip and
/downloads/SHA256SUMS.txt. These archives contain no provider/admin/customer key.
Windows offers official Claude Code installation and a key-entry window with
Paste, Show key, Connect and Cancel. Linux/macOS uses a visible pasteable prompt.
The gateway settings apply to that Claude Code session, not the global profile.

The customer portal identifies the underlying provider. Service preset cards are
UI previews and do not change actual routing. All paid requests use the same
bounded non-thinking Flash route; images/documents and provider server tools are
not supported. Text and customer-executed tool turns are supported.

## Metering and verification

Before contacting the paid provider, the server counts the prompt with the
official tokenizer and reserves its input cost plus affordable output. It streams
live output, saves pending usage estimates every five seconds, and debits the
provider-confirmed cumulative usage once. Apply the updated schema.sql before
deploying the streaming update; it adds two pending-progress columns.
Insufficient allowance prevents the call; ambiguous provider failures retain the
reservation and require reconciliation. See [METERING.md](METERING.md).

Run npm ci and npm run build locally to package and test. Tests cover bounds,
reference encoder/tokenizer fixtures, cost settlement, tariff failures, client
setup, portal authentication, download integrity and source-file isolation.
They use a mocked billing database. Verify a small deployed session and live
database/provider accounting before scaling sales. Hosting/payment fees are
separate from the model-cost allowance.

For a Render Web Service alternative, see [RENDER.md](RENDER.md).
