import { CREDIT_POLICY } from './credit-pricing.mjs';
import { REQUEST_LIMITS } from './request-limits.mjs';
import { verifiedProviderPrices } from './provider-prices.mjs';

// Safe diagnostics: report configuration names and requirements, never values of
// credentials, connection strings, request bodies or customer keys.
export async function inferenceStatus(env = process.env, { verifyPrices = verifiedProviderPrices } = {}) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (env.INFERENCE_ENABLED !== 'true') add('SERVICE_DISABLED', 'Set INFERENCE_ENABLED=true in Production/Functions after completing service validation.');
  if (!env.DEEPSEEK_API_KEY) add('PROVIDER_MISSING', 'DEEPSEEK_API_KEY is missing from the Functions environment.');
  if (env.CREDIT_POLICY && env.CREDIT_POLICY !== CREDIT_POLICY) add('CREDIT_POLICY_UNSUPPORTED', `Use CREDIT_POLICY=${CREDIT_POLICY} or remove the override.`);
  let prices = null;
  if (!issues.length) {
    try { prices = await verifyPrices(); } catch { prices = { ready: false }; }
    if (!prices.ready) add('PROVIDER_PRICE_CHECK_FAILED', 'Automatic verification of the official provider price/model page failed. Calls are paused; check outbound HTTPS access or provider tariff/model changes. No manual timestamp is needed.');
  }
  const ready = issues.length === 0;
  return {
    ready, code: ready ? 'READY' : issues[0].code, issues,
    customerMessage: ready ? 'ApiDuck is ready to connect.' : 'ApiDuck is temporarily unavailable. Your key was accepted. Contact your seller with this code: ' + issues[0].code,
    limits: REQUEST_LIMITS,
    pricing: { mode: 'automatic', verifiedAt: prices?.ready ? new Date(prices.checkedAt).toISOString() : null },
    billing: {streaming:true,checkpointSeconds:5,inputCounting:'official-tokenizer',settlement:'provider-final-usage'},
  };
}
