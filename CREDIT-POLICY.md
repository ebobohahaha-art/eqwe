# 10M internal credits: $0.20 provider-cost allowance

Each credit represents 20 nanodollars of model allowance. Customer grants now
mean INTERNAL CREDITS, not DeepSeek tokens. Sell a key through Playerok or another
marketplace, create a distinct customer in /admin, grant 10000000 credits, and
deliver only that customer's sk-gw key privately.

Policy deepseek-flash-cost-v1 uses the published 2026-11-19 Flash peak prices plus
at least 20% margin: 360 nanodollars per uncached input token, 8 per cached input
token and 1440 per output token. Cache creation uses the uncached rate. Each call
rounds UP to whole credits. Thinking and paid server tools are disabled.
Source: https://api-docs.deepseek.com/quick_start/pricing/

PostgreSQL reserves the verified FULL request ceiling priced entirely as output
(72 credits/token) before contacting DeepSeek. One outstanding reservation per
customer prevents concurrent overspending. Ambiguous outcomes retain the hold;
settlement is idempotent and records the conservative cost bound in the ledger.

RELEASE BLOCKER: the provider-wide 1M-token ceiling needs 72M credits and cannot
fit a 10M-credit key. That package needs a VERIFIED, SERVER-ENFORCED bound at most
138888 total provider tokens per call, decreasing as balance decreases. Do not
simply lower MAX_PROVIDER_REQUEST_TOKENS: an approximate tokenizer is not a verified
provider bound. The implementation refuses calls that cannot reserve the full
bound. A tighter validated request limit or separately funded risk reserve is
needed before 10M-credit keys can serve ordinary requests. No live cap is claimed.

Deployment:

1. Keep INFERENCE_ENABLED=false. Apply schema.sql. Reconcile old raw-token usage
   and outstanding holds before converting existing balances to credits.
2. Use PUBLIC_ORIGIN=https://apily.netlify.app. This is also the connector default.
   Set PUBLIC_ORIGIN only when intentionally releasing for a different domain.
3. Configure server-only DATABASE_URL, DEEPSEEK_API_KEY and ADMIN_ACCESS_KEY.
4. Set CREDIT_POLICY=deepseek-flash-cost-v1. After actually rechecking prices, set
   PROVIDER_PRICING_VERIFIED_AT to that UTC ISO timestamp. Verification expires
   after 24h; never automatically renew without checking the tariff.
5. Verify MAX_PROVIDER_REQUEST_TOKENS against an enforced full request bound.
   Test real PostgreSQL locking, revocation, duplicate/concurrent requests,
   failures, interruptions, SSE/tool calls, and provider invoices before enabling.
6. Build: npm run build. Publish directory: public. Downloads live under /downloads.

This bounds model cost only while the reviewed tariff and request bound hold.
Provider price changes/contract violations, hosting and payment fees are separate.
Do not advertise the service as live or guaranteed until deployment checks pass.
