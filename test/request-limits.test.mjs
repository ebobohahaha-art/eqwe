import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRequest, readRequestBody, REQUEST_LIMITS } from '../lib/request-limits.mjs';
import { createMessagesHandler } from '../netlify/functions/messages.mjs';
import { readFileSync } from 'node:fs';

const base=()=>({model:'apiduck-fast',max_tokens:32000,messages:[{role:'user',content:'Hello'}]});
test('Request bounds exceed official Flash-1017 encoder bytes and tokenizer counts for retained reference cases',()=>{
  const reference=JSON.parse(readFileSync(new URL('./fixtures/request-bound-reference.json',import.meta.url),'utf8'));
  assert.equal(reference.casesChecked,321);
  for(const row of reference.cases) {
    const prepared=prepareRequest(row.body);
    assert.ok(prepared.inputTokens>=row.referenceEncodedBytes);
    assert.ok(row.referenceEncodedBytes>=row.referenceInputTokens);
  }
});
test('Server clamps output, normalizes supported tool turns and ignores unsafe client overrides',()=>{
  const body=base();
  Object.assign(body,{model:'claude-opus',thinking:{type:'enabled'},output_config:{effort:'max'},metadata:{key:'unused'}});
  body.tools=[{name:'read_file',description:'Read a file',input_schema:{type:'object',properties:{path:{type:'string'}}}}];
  body.messages.push({role:'assistant',content:[{type:'tool_use',id:'tool_1',name:'read_file',input:{path:'sample.txt'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'tool_1',content:[{type:'text',text:'file text'}]}]});
  const prepared=prepareRequest(body);
  assert.equal(prepared.outputTokens,4096);
  assert.equal(prepared.upstream.model,'deepseek-flash');
  assert.equal(prepared.upstream.thinking.type,'disabled');
  assert.equal(prepared.upstream.output_config,undefined);
  assert.equal(prepared.upstream.metadata,undefined);
  assert.ok(prepared.inputTokens<REQUEST_LIMITS.inputTokens);
  assert.equal(JSON.parse(prepared.serialized).max_tokens,4096);
});
test('Images, documents, server tools, media placeholders and oversized/deep requests are rejected',()=>{
  const cases=[null,{...base(),tools:{}},{...base(),tools:[{type:'web_search',name:'search',input_schema:{}}]},
    {...base(),messages:Array.from({length:257},()=>({role:'user',content:'x'}))},
    {...base(),messages:[{role:'user',content:'x'.repeat(130000)}]},
    {...base(),messages:[{role:'user',content:'<image>https://untrusted.test/huge.png</image>'}]},
    ...['image','document','server_tool_use','thinking'].map(type=>({...base(),messages:[{role:'user',content:[{type,source:{type:'url',url:'https://untrusted.test'}}]}]})),
    {...base(),messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'tool_1',content:[{type:'image'}]}]}]},
  ];
  let deep={}; for(let i=0;i<35;i++)deep={inner:deep};
  cases.push({...base(),tools:[{name:'deep',input_schema:deep}]});
  for(const body of cases)assert.throws(()=>prepareRequest(body),e=>[400,413].includes(e.status));
});
test('Raw body size is enforced while reading, before JSON parsing',async()=>{
  const req=new Request('https://gateway.test/v1/messages',{method:'POST',body:'X'.repeat(512001)});
  await assert.rejects(readRequestBody(req),e=>e.status===413);
});

test('Invalid requests and unverified tariffs never contact the paid provider or database',async(t)=>{
  const before={INFERENCE_ENABLED:process.env.INFERENCE_ENABLED,DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,CREDIT_POLICY:process.env.CREDIT_POLICY};
  t.after(()=>{for(const[n,v]of Object.entries(before)){if(v===undefined)delete process.env[n];else process.env[n]=v;}});
  Object.assign(process.env,{INFERENCE_ENABLED:'true',DEEPSEEK_API_KEY:'dummy-provider',CREDIT_POLICY:'deepseek-flash-cost-v1'});
  const handler=createMessagesHandler({getDatabase:()=>{throw new Error('DB must not be called');},providerFetch:async()=>{throw new Error('Paid provider must not be called');},verifyPrices:async()=>({ready:false})});
  for(const[body,status]of [[base(),503],[{...base(),messages:[{role:'user',content:'x'.repeat(130000)}]},413]]) {
    const response=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`},body:JSON.stringify(body)}));
    assert.equal(response.status,status);
  }
});

test('An entire 10M-credit key stops before overspending and provider-bound violations freeze the account',async(t)=>{
  const before={INFERENCE_ENABLED:process.env.INFERENCE_ENABLED,DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,CREDIT_POLICY:process.env.CREDIT_POLICY};
  t.after(()=>{for(const[n,v]of Object.entries(before)){if(v===undefined)delete process.env[n];else process.env[n]=v;}});
  Object.assign(process.env,{INFERENCE_ENABLED:'true',DEEPSEEK_API_KEY:'dummy-provider',CREDIT_POLICY:'deepseek-flash-cost-v1'});
  let balance=10000000n,held=0,disabled=false,usage={input_tokens:100,output_tokens:50},calls=0,peakCost=0n;
  let content=[{type:'text',text:'ok'}];
  const client={release(){},async query(sql,args){
    if(sql.includes('key_hash'))return{rows:[{id:'customer',disabled}]};
    if(sql.includes('AS balance'))return{rows:[{balance:String(balance)}]};
    if(sql.includes('SELECT id FROM token_reservations'))return{rows:[],rowCount:0};
    if(sql.includes('INSERT INTO token_reservations'))held=args[2];
    if(sql.includes('SELECT status'))return{rows:[{status:'held',reserved_tokens:String(held)}]};
    if(sql.includes('INSERT INTO token_events'))balance+=BigInt(args[2]);
    if(sql.includes('UPDATE customers SET disabled'))disabled=true;
    return{rows:[],rowCount:0};
  }};
  const handler=createMessagesHandler({getDatabase:()=>({connect:async()=>client}),verifyPrices:async()=>({ready:true}),providerFetch:async()=>{
    calls++; peakCost+=BigInt(usage.input_tokens)*300n+BigInt(usage.output_tokens)*1200n;
    return Response.json({type:'message',content,stop_reason:'end_turn',usage});
  }});
  const invoke=()=>handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`},body:JSON.stringify({...base(),max_tokens:100})}));
  let status=200;
  for(let i=0;i<2500&&status===200;i++)status=(await invoke()).status;
  assert.equal(status,402);
  assert.ok(calls>1);
  assert.ok(balance>=0n);
  assert.ok(peakCost<=200000000n);
  assert.ok(peakCost<=(10000000n-balance)*20n);
  balance=10000000n;
  content=[{type:'text',text:'Reading the file.'},{type:'tool_use',id:'call_1',name:'read_file',input:{path:'sample.txt'}}];
  const streamed=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`},body:JSON.stringify({...base(),max_tokens:100,stream:true})}));
  assert.equal(streamed.status,200);
  const frames=(await streamed.text()).split('\n\n').filter(Boolean).map(frame=>JSON.parse(frame.split('\ndata: ')[1]));
  assert.equal(frames[0].message.model,'apiduck-fast');
  assert.equal(frames.find(f=>f.delta?.type==='text_delta').delta.text,'Reading the file.');
  assert.deepEqual(JSON.parse(frames.find(f=>f.delta?.type==='input_json_delta').delta.partial_json),{path:'sample.txt'});
  assert.equal(frames.at(-1).type,'message_stop');
  // Output violation can fit inside the conservative input reservation; it must
  // nevertheless freeze the account rather than silently trusting the model.
  balance=10000000n; usage={input_tokens:1,output_tokens:101};
  assert.equal((await invoke()).status,503);
  assert.equal(disabled,true);
  const previousCalls=calls;
  assert.equal((await invoke()).status,401);
  assert.equal(calls,previousCalls);
});
