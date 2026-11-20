import { assertPricingVerified, CREDIT_POLICY, reservationCredits } from './credit-pricing.mjs';

// Safe diagnostics: report configuration names and requirements, never values of
// credentials, connection strings, request bodies or customer keys.
export function inferenceStatus(env = process.env, now = Date.now()) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (env.INFERENCE_ENABLED !== 'true') add('SERVICE_DISABLED', 'Set INFERENCE_ENABLED=true in Production/Functions after completing service validation.');
  if (!env.DEEPSEEK_API_KEY) add('PROVIDER_MISSING', 'DEEPSEEK_API_KEY is missing from the Functions environment.');
  if (env.CREDIT_POLICY !== CREDIT_POLICY) add('CREDIT_POLICY_MISSING', `Set CREDIT_POLICY=${CREDIT_POLICY}.`);
  try { assertPricingVerified({ ...env, CREDIT_POLICY }, now); }
  catch { add('PRICING_REVIEW_REQUIRED', 'PROVIDER_PRICING_VERIFIED_AT must record an actual provider-price review within the last 24 hours.'); }
  const ceiling = Number(env.MAX_PROVIDER_REQUEST_TOKENS);
  let requiredReservation = null;
  try { requiredReservation = reservationCredits(ceiling); }
  catch { add('REQUEST_BOUND_MISSING', 'MAX_PROVIDER_REQUEST_TOKENS must be a verified and enforced positive whole-number request ceiling. Do not invent a low value.'); }
  const ready = issues.length === 0;
  return {
    ready, code: ready ? 'READY' : issues[0].code, issues,
    customerMessage: ready ? 'ApiDuck is ready to connect.' : 'ApiDuck is temporarily unavailable. Your key was accepted. Contact your seller with this code: ' + issues[0].code,
    requiredReservationCredits: requiredReservation,
  };
}
