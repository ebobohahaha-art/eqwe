# ApiDuck cost credits

10,000,000 internal ApiDuck credits represent a $0.20 model-cost allowance.
They are not 10M DeepSeek tokens. One credit represents 20 nanodollars.

The Flash cost policy charges 360 nanodollars per uncached input token, 8 per
cached input token, and 1440 per output token, rounding each call UP to credits.
These bounds exceed the published peak rates checked on 2026-11-20. Cache
creation uses the uncached rate. Off-peak savings provide additional margin.

Before generation, the server validates and bounds the actual request. It
reserves the input bound at the uncached rate plus the enforced output cap.
An empty or insufficient balance returns 402 without a paid provider call.
Database row locks and a unique outstanding reservation prevent concurrent
requests from reusing the same allowance. Settlement is idempotent. Ambiguous
outcomes retain their hold; provider bound violations freeze the customer.

Request bounds are now enforced in code. The previous manual
MAX_PROVIDER_REQUEST_TOKENS setting is ignored. Provider prices and model version
are checked automatically against the official public price page, with a five-
minute cache. PROVIDER_PRICING_VERIFIED_AT is no longer needed or trusted. Price
verification failure pauses generation rather than silently accepting risk.
See [REQUEST-LIMITS.md](REQUEST-LIMITS.md) for the derivation and limitations.

Deployment update:

1. Upload the complete updated source contents to the GitHub repository root,
   including all lib files and tests/fixtures. Build: npm run build. Publish: public.
2. Keep DATABASE_URL, DEEPSEEK_API_KEY and ADMIN_ACCESS_KEY in Functions only.
   PUBLIC_ORIGIN=https://apily.netlify.app is configured in netlify.toml.
3. INFERENCE_ENABLED=true enables customer inference. CREDIT_POLICY may be absent
   or deepseek-flash-cost-v1. Remove obsolete timestamp/ceiling variables or leave
   them unused; arbitrary values cannot bypass enforced request limits.
4. Apply schema.sql if the earlier cost-accounting columns are not installed.
   This update adds no further columns. Reconcile any old raw-token balances and
   outstanding holds before converting an older deployment.
5. Redeploy, sign into /admin, and check Gateway setup. Issue distinct customer
   keys with 10000000 credits for the package. Deliver only their sk-gw key privately.
6. Verify a small real customer session and reconcile its ledger against provider
   usage before selling at scale. Automated tests use a mocked billing database;
   they do not establish live PostgreSQL, Netlify or provider behavior.

This allowance covers model usage under the provider's published contract, not
hosting, payment or marketplace fees. Price/contract changes between checks can
still incur unexpected costs; conservative margins and holds reduce that exposure
but cannot reverse a provider charge. Large histories can be refused or accounts
can stop early when their remaining balance cannot reserve the next request.
