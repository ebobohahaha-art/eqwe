# Enforced request bounds and automated tariff checks

The streaming-billing update uses lib/exact-input.mjs and the pinned official
tokenizer asset for reservations. The byte-bound derivation below remains a
structural validation ceiling and fallback; it is no longer the amount charged
or the sole estimate used to authorize a request.

This replaces the manual MAX_PROVIDER_REQUEST_TOKENS and
PROVIDER_PRICING_VERIFIED_AT gates. Neither variable authorizes provider calls
anymore. CREDIT_POLICY defaults to deepseek-flash-cost-v1; a different explicit
policy value is rejected. INFERENCE_ENABLED=true is still the operator's switch.

The gateway bounds requests before making a paid call:

- Read at most 512000 raw bytes; accept at most 350000 canonical UTF-8 JSON bytes.
- Allow text, ordinary client tool definitions, assistant tool calls and text
  tool results. Reject media, remote documents, provider tools, stored thinking,
  image placeholders, excessive nesting, and oversized/complex conversations.
- Strip other fields. Force DeepSeek Flash, thinking disabled, and nonstreaming
  upstream generation. Clamp max_tokens to 4096 even when the client asks for more.
- Bound verbatim text by its UTF-8 bytes once and structured JSON by twice its
  compact JSON bytes, plus 256 bytes per message/block/tool or top-level tool
  argument, plus 8192 bytes of fixed formatting overhead. Refuse
  anything whose bound exceeds 500000 tokens. The conservative multipliers cover
  schema JSON spacing/escaping and DSML formatting; they are not cl100k estimates.
- Count the official rendered input, add a 2048-token protocol guard plus 64 per
  message/tool, and use the smaller of this bound and the structural byte bound.
  The tokenizer definition is SHA-pinned and counts all retained reference cases
  identically to the official Rust/Python tokenizer.
- Reserve this input at the uncached rate and choose an output token limit from
  the remaining balance (at most the client's request and the 4096 server cap).
  Even the maximum structural request reserves 9294912 credits, fitting a
  fresh 10M-credit key. Small requests reserve less. Refuse insufficient balances
  before calling the provider if input plus one output token cannot fit. Output
  is genuinely reduced upstream when shrinking its reservation; the input bound
  is never lowered to force acceptance.
- Settle measured cost credits once. Uncertain failures retain their holds.
  A measured input/output bound violation freezes the account even if its cost
  happened to fit the conservative reservation.

The terminal connector declares a 100K working context. The desktop app manages
its own context and does not inherit terminal-only session settings. Requests
with many desktop/MCP tool schemas are allowed when they fit the server bounds
and remaining credits; no schema or system text is silently removed.

Client context variables encourage early compaction; they are convenience only.
Only the server's validated request and database reservation authorize spending.
No user-controlled tokenizer estimate or environment ceiling can bypass this.

Why a byte bound is applicable: the official Flash-1017 tokenizer has an empty
normalizer and a byte-level BPE pretokenizer without prefix-space insertion. Each
UTF-8 byte starts as one symbol; merges cannot increase token count. Special
markers shorten rather than expand their textual byte representation. The
official reference encoder adds turn markers, the tool preamble and DSML wrappers;
the accepted schema and conservative overhead bound these transformations.

Reference sources, reviewed 2026-11-20:

- https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/blob/main/encoding/encoding.py
  SHA256 13231c592e958fb39e2af6001dae69d90e7a36b265702b9b390236fb387599e2
- https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/blob/main/tokenizer.json
  SHA256 c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b
- https://api-docs.deepseek.com/guides/anthropic_api/
- https://api-docs.deepseek.com/quick_start/pricing/

322 local cases were checked against the official encoder and tokenizer; 26
retained fixtures cover text, Unicode, escaped characters, tool schemas/calls,
tool results, a large text prompt and a desktop-sized request with 103 client
tools. All had actual tokens <= rendered bytes <=
the enforced bound. These regressions support the derivation; they are not a
promise about arbitrary future provider behavior or proof of live billing.

The price verifier fetches the official public price table over HTTPS, expands
row/column spans, and checks PEAK Flash rates against conservative bounds. It
also requires the exact Flash-1017 model version, protecting tokenizer assumptions.
Successful checks are cached for five minutes per instance; failures for fifteen
seconds. Concurrent checks share a request. A fetch failure, unparseable table,
model change, or tariff above the configured bounds pauses generation. There is
no manual timestamp override and no stale-success fallback after cache expiry.

The model-provider contract remains a dependency. A price change during the
five-minute cache window or a provider violating documented limits can incur
unexpected costs; the tariff margin and account freeze reduce exposure but cannot
undo an already accepted provider charge. Hosting/payment fees are separate.
