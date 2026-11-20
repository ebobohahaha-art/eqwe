import { database } from "../../lib/db.mjs";
import { keyHash } from "../../lib/keys.mjs";
import { reserveTokens, settleTokens, measuredUsage, checkpointTokens } from "../../lib/quota.mjs";
import { CREDIT_POLICY, priceUsage, requestReservation, inputReservation, OUTPUT_CREDITS_PER_TOKEN } from "../../lib/credit-pricing.mjs";
import { prepareRequest, readRequestBody, REQUEST_LIMITS } from "../../lib/request-limits.mjs";
import { verifiedProviderPrices } from "../../lib/provider-prices.mjs";
import { countInput } from "../../lib/exact-input.mjs";
import { consumeProviderStream, encodeEvent } from "../../lib/provider-stream.mjs";

function failure(message, status) {
  return Response.json({ type:"error", error: { type: "api_error", message } }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}
// Compatibility fallback when the provider returns a complete JSON response.
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
export function createMessagesHandler({ getDatabase = database, providerFetch = (...args) => fetch(...args), verifyPrices = verifiedProviderPrices, checkpointIntervalMs=5000 } = {}) {
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
    const counted=countInput(prepared.upstream);
    if (counted.inputTokens > REQUEST_LIMITS.inputTokens) return failure('Conversation exceeds the 500000-token gateway input limit. Compact the conversation or shorten tool output.',400);
    prepared.inputTokens=Math.min(prepared.inputTokens,counted.inputTokens);
    const creditCeiling = requestReservation(prepared.inputTokens, prepared.outputTokens);
    const prices = await verifyPrices();
    if (!prices.ready) return failure("ApiDuck could not verify current provider pricing. Please try again later.", 503);
    reservation = await reserveTokens(getDatabase(), hash, creditCeiling,{inputCredits:inputReservation(prepared.inputTokens),creditsPerOutputToken:OUTPUT_CREDITS_PER_TOKEN,maxOutputTokens:prepared.outputTokens});
    prepared.outputTokens=reservation.outputTokens;
    prepared.upstream.max_tokens=prepared.outputTokens;
    prepared.upstream.stream=true;
    prepared.serialized=JSON.stringify(prepared.upstream);
    const aborter=new AbortController();
    const signal=AbortSignal.any([AbortSignal.timeout(45000),req.signal,aborter.signal]);
    const result = await providerFetch("https://api.deepseek.com/anthropic/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.DEEPSEEK_API_KEY },
      body: prepared.serialized, signal, redirect: 'error',
    });
    if (!result.ok) throw new Error("Provider rejected request");
    async function finish(message){
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
    if (settlement.overrun) throw Object.assign(new Error('Provider exceeded its authorized limit. Account frozen for reconciliation.'),{status:503,settled:true});
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
    return {message,headers};
    }
    if(result.headers.get('content-type')?.includes('text/event-stream')){
      const alias=body.model==='apiduck-fast'?'apiduck-fast':undefined;
      async function pump(onEvent){
        const progress={input:counted.tokens,outputBytes:0};let pending=null;
        const flush=()=>{
          if(pending)return pending;
          const estimate=Math.min(reservation.reservedCredits,requestReservation(Math.max(1,progress.input),Math.max(1,Math.min(prepared.outputTokens,progress.outputBytes))));
          pending=checkpointTokens(getDatabase(),reservation,estimate).then(state=>{if(state.revoked)throw new Error('Account revoked');}).finally(()=>{pending=null;});
          return pending;
        };
        const timer=setInterval(()=>{flush().then(()=>onEvent?.('ping',{})).catch(()=>aborter.abort());},checkpointIntervalMs);
        try{
          await flush();
          const message=await consumeProviderStream(result,{alias,progress,onEvent:async(type,data)=>{if(type==='message_start')await flush();if(onEvent)await onEvent(type,data);}});
          // If a checkpoint failed just as the provider completed, still try to
          // settle its verified final usage. Never discard a known final bill.
          clearInterval(timer);if(pending)await pending.catch(()=>{});
          return await finish(message);
        }finally{clearInterval(timer);}
      }
      if(body.stream){
        const readable=new ReadableStream({
          start(controller){
            const send=(type,data)=>controller.enqueue(encodeEvent(type,data));
            pump(send).then(({message})=>{
              send('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:message.stop_sequence??null},usage:message.usage});
              send('message_stop',{});controller.close();
            }).catch(error=>{aborter.abort();try{send('error',{error:{type:'api_error',message:error.settled?error.message:`Stream interrupted. Reservation ${reservation.id} is held for usage reconciliation.`}});controller.close();}catch{}});
          },cancel(){aborter.abort();}
        });
        return new Response(readable,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','X-Gateway-Request-ID':reservation.id}});
      }
      const {message,headers}=await pump();return new Response(JSON.stringify(message),{headers});
    }
    const {message,headers}=await finish(await result.json());
    return new Response(body.stream ? asSse(message) : JSON.stringify(message), { headers });
  } catch (error) {
    if (reservation && !error.settled) {
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
