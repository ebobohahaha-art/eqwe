// Reviewed 2026-11-19 against https://api-docs.deepseek.com/quick_start/pricing/
// Conservative Flash PEAK prices plus 20% margin. No off-peak discount assumed.
// 10M internal credits = $0.20: one credit represents 20 nanodollars.
import { measuredUsage } from './quota.mjs';
import { PRICE_BOUNDS } from './provider-prices.mjs';
export const CREDIT_POLICY = 'deepseek-flash-cost-v1';
export const NANODOLLARS_PER_CREDIT = 20n;
const INPUT = BigInt(PRICE_BOUNDS.input), CACHE = BigInt(PRICE_BOUNDS.cache), OUTPUT = BigInt(PRICE_BOUNDS.output);
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
export function requestReservation(inputTokens, outputTokens) {
  safe(inputTokens); safe(outputTokens);
  if (inputTokens < 1 || outputTokens < 1) throw new Error('Positive enforced request limits required');
  // Cache status is unknown before generation. Reserve every input token at
  // the uncached rate, plus the full enforced non-thinking output ceiling.
  return credits(BigInt(inputTokens) * INPUT + BigInt(outputTokens) * OUTPUT);
}
