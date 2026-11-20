# Hosted cost-credit metering

Customer keys and balances are enforced by the hosted PostgreSQL ledger. A
connector contains only the public HTTPS gateway URL. Customers enter their own
sk-gw key. Provider/admin/database credentials never enter the browser or ZIP.

The server authenticates the key, rejects revocation, bounds each text/client-tool
request, automatically checks the provider tariff/model version, and reserves
its maximum conservative cost before generation. It settles measured usage once
before returning JSON or buffered SSE. Uncertain outcomes retain their hold and
block further calls pending reconciliation. Never delete ambiguous holds blindly.

10M credits are a $0.20 model-cost allowance, not raw provider tokens. Input,
cached input and output have different credit charges. Read [CREDIT-POLICY.md](CREDIT-POLICY.md)
and [REQUEST-LIMITS.md](REQUEST-LIMITS.md) for rates, limits and operational details.

Manual provider-price timestamps and request-ceiling environment variables are
obsolete. The enabled service requires its database/schema and provider key,
INFERENCE_ENABLED=true, a supported cost policy, and successful automatic tariff
verification. /admin displays configuration diagnostics without disclosing secrets.

Client max_tokens is clamped to 4096. Images/documents, paid provider tools and
thinking histories are rejected. Large conversations must be compacted. The
connector encourages early compaction; server bounds remain authoritative.

The count_tokens endpoint is a cl100k compatibility estimate only. It does not
authorize spend. Provider token usage fields are preserved in responses; internal
allowance is exposed separately through X-Gateway-Credits-Used and
X-Gateway-Credits-Remaining. Token input/output usage is not replaced by credits.

Streams are buffered, then emitted as message_start, content block start/delta/
stop events and final message events. Text and client tool JSON deltas are
supported. Provider timeout is 45 seconds; deployment timeouts can interrupt a
call after the provider has accepted it. Such calls require reconciliation.

Before scaling paid sales, validate real database locking/concurrency, revocation,
duplicate settlement, cold starts, provider errors, interrupted requests, CLI tool
use and usage reconciliation on the deployed service. Offline tests and official
encoder fixtures do not prove every property of the live distributed system.
