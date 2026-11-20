#!/usr/bin/env bash
set -euo pipefail
connector_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
base_url="$(cat "$connector_dir/gateway-url.txt")"
if [[ ! "$base_url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]; then
  echo 'Invalid HTTPS gateway origin in connector.' >&2; exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo 'Install the official Claude Code CLI: https://code.claude.com/docs/en/setup' >&2; exit 1
fi
for dependency in curl node; do
  command -v "$dependency" >/dev/null 2>&1 || { echo "$dependency is required for the account check." >&2; exit 1; }
done
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$base_url/#downloads" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "$base_url/#downloads" >/dev/null 2>&1 &
fi
read -r -p 'Paste your customer key (visible; Ctrl+Shift+V in most terminals): ' customer_key
printf '\n'
trap 'unset customer_key ANTHROPIC_AUTH_TOKEN' EXIT
if [[ ! "$customer_key" =~ ^sk-gw-[a-f0-9]{64}$ ]]; then
  echo 'Use your individual customer key, not a provider key.' >&2; exit 1
fi
# Supply the header on stdin so the key is absent from curl argv.
if ! account="$(printf 'Authorization: Bearer %s\n' "$customer_key" | curl --silent --show-error --fail --proto '=https' --max-time 20 --header @- "$base_url/api/account")"; then
  echo 'Account check failed. Check your key and portal connection.' >&2; exit 1
fi
if ! printf '%s' "$account" | node -e '
let raw=""; process.stdin.on("data", c => raw += c);
process.stdin.on("end", () => { try {
  const a=JSON.parse(raw);
  if (!a.customer?.id || a.inferenceEnabled !== true || !/^\d+$/.test(a.tokens?.remaining) || BigInt(a.tokens.remaining)<=0n) process.exit(1);
} catch { process.exit(1); } });'; then
  echo 'Inference is unavailable or your allowance is empty. Check the portal.' >&2; exit 1
fi
unset ANTHROPIC_API_KEY ANTHROPIC_CUSTOM_HEADERS
export ANTHROPIC_BASE_URL="$base_url" ANTHROPIC_AUTH_TOKEN="$customer_key"
export ANTHROPIC_MODEL=apiduck-fast ANTHROPIC_DEFAULT_OPUS_MODEL=apiduck-fast
export ANTHROPIC_DEFAULT_SONNET_MODEL=apiduck-fast ANTHROPIC_DEFAULT_HAIKU_MODEL=apiduck-fast
export CLAUDE_CODE_SUBAGENT_MODEL=apiduck-fast CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096
export ANTHROPIC_DEFAULT_OPUS_MODEL_NAME='ApiDuck Fast' ANTHROPIC_DEFAULT_SONNET_MODEL_NAME='ApiDuck Fast' ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME='ApiDuck Fast'
export ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION='ApiDuck gateway service. Provider details are on your account portal.'
export ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION="$ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION"
export ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION="$ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=32000 CLAUDE_CODE_AUTO_COMPACT_WINDOW=20000
unset customer_key
echo "Connected through $base_url. Your allowance is enforced by the hosted gateway."
exec claude "$@"
