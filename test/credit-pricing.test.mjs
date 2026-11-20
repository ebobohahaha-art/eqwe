import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceUsage, requestReservation, CREDIT_POLICY } from '../lib/credit-pricing.mjs';
import { prepareRequest } from '../lib/request-limits.mjs';
import { createMessagesHandler } from '../netlify/functions/messages.mjs';

test('Cost credits price input, cache and output separately, always rounding upward', () => {
  assert.equal(priceUsage({input_tokens:1,output_tokens:0}).credits,18);
  assert.equal(priceUsage({input_tokens:0,output_tokens:1}).credits,72);
  assert.equal(priceUsage({input_tokens:0,output_tokens:0,cache_read_input_tokens:1}).credits,1);
  assert.equal(priceUsage({input_tokens:10,output_tokens:5,cache_read_input_tokens:20,cache_creation_input_tokens:3}).credits,602);
  assert.throws(() => priceUsage({input_tokens:1,output_tokens:0,server_tool_use:{web_search_requests:1}}));
  assert.throws(() => requestReservation(Number.MAX_SAFE_INTEGER,4096));
});
test('Every accepted 10M-credit mix stays below $0.20 at published peak prices', () => {
  for (const [input, cache, output] of [[0,0,138888],[555555,0,0],[0,25000000,0],[100000,5000000,50000]]) {
    const usage={input_tokens:input,cache_read_input_tokens:cache,output_tokens:output};
    const priced=priceUsage(usage);
    if (priced.credits <= 10000000) {
      const publishedPeakNanos=BigInt(input)*300n+BigInt(cache)*6n+BigInt(output)*1200n;
      assert.ok(publishedPeakNanos<=200000000n);
      assert.ok(publishedPeakNanos<=BigInt(priced.credits)*20n);
    }
  }
  assert.equal(requestReservation(500000,4096),9294912);
});

test('Hosted inference reserves cost credits, audits settlement, and blocks depleted/revoked/pending keys', async (t) => {
  const names=['INFERENCE_ENABLED','DEEPSEEK_API_KEY','MAX_PROVIDER_REQUEST_TOKENS','CREDIT_POLICY','PROVIDER_PRICING_VERIFIED_AT'];
  const before=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  t.after(()=>{for(const n of names) { if(before[n]===undefined) delete process.env[n]; else process.env[n]=before[n]; }});
  Object.assign(process.env,{INFERENCE_ENABLED:'true',DEEPSEEK_API_KEY:'dummy-provider-not-real',MAX_PROVIDER_REQUEST_TOKENS:'1000',CREDIT_POLICY,PROVIDER_PRICING_VERIFIED_AT:new Date().toISOString()});
  for (const scenario of ['normal','branded','depleted','revoked','pending','ambiguous']) {
    const queries=[]; let calls=0;
    const client={release(){}, async query(sql,args){
      queries.push([sql,args]);
      if(sql.includes('key_hash')) return {rows:[{id:'customer',disabled:scenario==='revoked'}]};
      if(sql.includes('SELECT id FROM token_reservations')) return {rowCount:scenario==='pending'?1:0,rows:[]};
      if(sql.includes('AS balance')) return {rows:[{balance:scenario==='depleted'?'0':'10000000'}]};
      if(sql.includes('SELECT status')) return {rows:[{status:'held',reserved_tokens:'72000'}]};
      return {rows:[],rowCount:0};
    }};
    const handler=createMessagesHandler({getDatabase:()=>({connect:async()=>client}),verifyPrices:async()=>({ready:true}),providerFetch:async(url,options)=>{
      calls++;
      assert.equal(url,'https://api.deepseek.com/anthropic/v1/messages');
      const body=JSON.parse(options.body); assert.equal(body.model,'deepseek-flash'); assert.equal(body.thinking.type,'disabled');
      if(scenario==='ambiguous') throw new Error('timeout');
      return Response.json({type:'message',model:'deepseek-flash',content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5}});
    }});
    const body={model:scenario==='branded'?'apiduck-fast':'claude-opus',max_tokens:100,messages:[{role:'user',content:'hello'}]};
    const limits=prepareRequest(body);
    const expectedReservation=requestReservation(limits.inputTokens,limits.outputTokens);
    const response=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`},body:JSON.stringify(body)}));
    assert.equal(response.status,{normal:200,branded:200,depleted:402,revoked:401,pending:409,ambiguous:503}[scenario]);
    assert.equal(calls,['normal','branded','ambiguous'].includes(scenario)?1:0);
    const hold=queries.find(([sql])=>sql.includes('INSERT INTO token_reservations'));
    if(hold) assert.equal(hold[1][2],expectedReservation);
    const debit=queries.find(([sql])=>sql.includes('INSERT INTO token_events'));
    if(['normal','branded'].includes(scenario)) {
      assert.equal(debit[1][2],-540);
      assert.equal(debit[1][4],CREDIT_POLICY);
      assert.equal(debit[1][5],'10800');
      assert.equal(response.headers.get('x-gateway-credits-used'),'540');
      assert.equal((await response.json()).model,scenario==='branded'?'apiduck-fast':'deepseek-flash');
    } else assert.equal(debit,undefined);
  }
});
