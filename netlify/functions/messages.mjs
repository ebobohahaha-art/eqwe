import { database } from "../../lib/db.mjs";
import { keyHash } from "../../lib/keys.mjs";
import { reserveTokens, settleTokens, measuredUsage } from "../../lib/quota.mjs";
import { CREDIT_POLICY, priceUsage, requestReservation } from "../../lib/credit-pricing.mjs";
import { prepareRequest, readRequestBody } from "../../lib/request-limits.mjs";
import { verifiedProviderPrices } from "../../lib/provider-prices.mjs";

function failure(message, status) {
  return Response.json({ type:"error", error: { type: "api_error", message } }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}
// Buffer upstream completion so verified usage is committed before returning an
// answer. Native incremental streaming and provider-error reconciliation are later work.
function asSse(message) {
  const events = [];
  const emit = (type, data) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  emit("message_start", { message: { ...message, content: [], stop_reason: null,
    usage: { ...message.usage, output_tokens: 0 } } });
  for (const [index, block] of message.content.entries()) {
    if (block.type === 'text') {
      emit("content_block_start", { index, content_block: { type: 'text', text: '' } });
      emit("content_block_delta", { index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'tool_use') {
      emit("content_block_start", { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      emit("content_block_delta", { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    emit("content_block_stop", { index });
  }
  emit("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: message.stop_sequence ?? null },
    usage: message.usage });
  emit("message_stop", {});
  return events.join("");
}
export function createMessagesHandler({ getDatabase = database, providerFetch = (...args) => fetch(...args), verifyPrices = verifiedProviderPrices } = {}) {
return async function messages(req) {
  if (req.method !== "POST") return failure("POST required", 405);
  if (new URL(req.url).protocol !== "https:") return failure("HTTPS required", 400);
  let hash;
  try {
    const key = /^Bearer (sk-gw-[a-f0-9]{64})$/.exec(req.headers.get("authorization") ?? "")?.[1]
      ?? req.headers.get("x-api-key");
    hash = keyHash(key);
  } catch { return failure("A valid customer API key is required", 401); }
  if (process.env.INFERENCE_ENABLED !== "true") return failure("Hosted inference has not been enabled by the administrator", 503);
  if (!process.env.DEEPSEEK_API_KEY) return failure("Provider is not configured", 503);
  if (process.env.CREDIT_POLICY && process.env.CREDIT_POLICY !== CREDIT_POLICY) return failure("Unsupported cost credit policy", 503);
  let reservation;
  try {
    const raw = await readRequestBody(req);
    let body;
    try { body = JSON.parse(raw); } catch { return failure("Invalid JSON", 400); }
    const prepared = prepareRequest(body);
    const creditCeiling = requestReservation(prepared.inputTokens, prepared.outputTokens);
    const prices = await verifyPrices();
    if (!prices.ready) return failure("ApiDuck could not verify current provider pricing. Please try again later.", 503);
    reservation = await reserveTokens(getDatabase(), hash, creditCeiling);
    const result = await providerFetch("https://api.deepseek.com/anthropic/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.DEEPSEEK_API_KEY },
      body: prepared.serialized, signal: AbortSignal.timeout(45000), redirect: 'error',
    });
    if (!result.ok) throw new Error("Provider rejected request");
    const message = await result.json();
    if (message.type !== "message" || !Array.isArray(message.content)) throw new Error("Invalid provider response");
    if (message.content.some(block => block.type === 'text' ? typeof block.text !== 'string' :
      block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string' || !block.input || typeof block.input !== 'object' || Array.isArray(block.input))) {
      throw new Error('Unsupported provider content');
    }
    const actual = measuredUsage(message.usage);
    const priced = priceUsage(message.usage);
    const input = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    priced.boundExceeded = input > prepared.inputTokens || message.usage.output_tokens > prepared.outputTokens;
    const settlement = await settleTokens(getDatabase(), reservation, priced.credits, priced);
    if (settlement.overrun) return failure("Provider exceeded the verified ceiling. Account frozen for reconciliation.", 503);
    // Preserve the public API alias requested by branded gateway clients.
    if (body.model === 'apiduck-fast') message.model = 'apiduck-fast';
    const headers = {
      "Cache-Control": "no-store", "X-Gateway-Provider-Tokens-Used": String(actual),
      "X-Gateway-Credits-Used": String(priced.credits),
      "X-Gateway-Credits-Remaining": settlement.remaining,
      "X-Gateway-Credit-Policy": priced.policy,
      "X-Gateway-Request-ID": reservation.id,
      "Content-Type": body.stream ? "text/event-stream; charset=utf-8" : "application/json",
    };
    return new Response(body.stream ? asSse(message) : JSON.stringify(message), { headers });
  } catch (error) {
    if (reservation) {
      // Unknown upstream billing outcome: never refund automatically. Durable
      // held reservation blocks further calls until an admin reconciles it.
      return failure(`Request could not be settled. Reservation ${reservation.id} held for support review.`, 503);
    }
    return failure(error.status ? error.message : "Account service unavailable", error.status ?? 503);
  }
};
}
export default createMessagesHandler();
export const config = { path: "/v1/messages" };
