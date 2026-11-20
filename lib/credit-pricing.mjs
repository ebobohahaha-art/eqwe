// Reviewed 2026-11-19 against https://api-docs.deepseek.com/quick_start/pricing/
// Conservative Flash PEAK prices plus 20% margin. No off-peak discount assumed.
// 10M internal credits = $0.20: one credit represents 20 nanodollars.
import { measuredUsage } from './quota.mjs';
export const CREDIT_POLICY = 'deepseek-flash-cost-v1';
export const NANODOLLARS_PER_CREDIT = 20n;
const INPUT = 360n, CACHE = 8n, OUTPUT = 1440n;
const safe = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid credit amount');
  return n;
};
function credits(nanos) {
  const result = Number((nanos + NANODOLLARS_PER_CREDIT - 1n) / NANODOLLARS_PER_CREDIT);
  return safe(result);
}
export function priceUsage(usage) {
  measuredUsage(usage); // Reject missing/negative/non-integer usage, including cache.
  if (Object.values(usage.server_tool_use ?? {}).some((n) => n !== 0)) {
    throw new Error('Unpriced provider tool usage requires reconciliation');
  }
  const nanos = (BigInt(usage.input_tokens) + BigInt(usage.cache_creation_input_tokens ?? 0)) * INPUT
    + BigInt(usage.cache_read_input_tokens ?? 0) * CACHE + BigInt(usage.output_tokens) * OUTPUT;
  return { credits: credits(nanos), costUpperBoundNanodollars: nanos.toString(), policy: CREDIT_POLICY };
}
export function reservationCredits(totalTokenCeiling) {
  safe(totalTokenCeiling);
  if (totalTokenCeiling < 1) throw new Error('Verified token ceiling required');
  // Every possible token priced as output: no tokenizer estimate can authorize spend.
  return credits(BigInt(totalTokenCeiling) * OUTPUT);
}
export function assertPricingVerified(env = process.env, now = Date.now()) {
  if (env.CREDIT_POLICY !== CREDIT_POLICY) throw new Error('Cost credit policy must be acknowledged');
  // Require operators to recheck the published prices daily. Never silently keep
  // selling a fixed budget under an indefinitely stale provider price snapshot.
  const checked = Date.parse(env.PROVIDER_PRICING_VERIFIED_AT ?? '');
  if (!Number.isFinite(checked) || checked > now || now - checked > 86400000) {
    throw new Error('Provider prices need verification within the last 24 hours');
  }
}
