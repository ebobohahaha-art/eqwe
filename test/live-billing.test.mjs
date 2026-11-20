import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMessagesHandler} from '../netlify/functions/messages.mjs';
import {prepareRequest} from '../lib/request-limits.mjs';
import {countInput} from '../lib/exact-input.mjs';
import {inputReservation,requestReservation} from '../lib/credit-pricing.mjs';
import {readFileSync} from 'node:fs';
const body=()=>({model:'apiduck-fast',max_tokens:4096,stream:true,messages:[{role:'user',content:'Hello'}]});
const headers={Authorization:`Bearer sk-gw-${'a'.repeat(64)}`};
function environment(t){const names=['INFERENCE_ENABLED','DEEPSEEK_API_KEY','CREDIT_POLICY'];const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));Object.assign(process.env,{INFERENCE_ENABLED:'true',DEEPSEEK_API_KEY:'dummy',CREDIT_POLICY:'deepseek-flash-cost-v1'});t.after(()=>{for(const[n,v]of Object.entries(previous)){if(v===undefined)delete process.env[n];else process.env[n]=v;}});}
function ledger(balance=10000000n){
  const state={balance,held:0,status:null,disabled:false,debits:[],checkpoints:[]};
  const client={release(){},async query(sql,args){
    if(sql.includes('key_hash'))return{rows:[{id:'customer',disabled:state.disabled}]};
    if(sql.includes('SELECT disabled'))return{rows:[{disabled:state.disabled}]};
    if(sql.includes('SELECT id FROM token_reservations'))return{rows:[],rowCount:state.status==='held'?1:0};
    if(sql.includes('AS balance'))return{rows:[{balance:String(state.balance)}]};
    if(sql.includes('INSERT INTO token_reservations')){state.held=args[2];state.status='held';}
    if(sql.includes('estimated_credits=$1')){state.checkpoints.push(args[0]);return{rows:[{reserved_tokens:String(state.held)}],rowCount:1};}
    if(sql.includes('SELECT status'))return{rows:[{status:state.status,reserved_tokens:String(state.held)}]};
    if(sql.includes('INSERT INTO token_events')){state.debits.push(args[2]);state.balance+=BigInt(args[2]);}
    if(sql.includes("status='settled'"))state.status='settled';
    if(sql.includes('UPDATE customers SET disabled'))state.disabled=true;
    return{rows:[],rowCount:0};
  }};
  return{state,db:{connect:async()=>client}};
}
function provider(){
  let controller,aborted=false;
  const encode=new TextEncoder();
  const stream=new ReadableStream({start(c){controller=c;}});
  const emit=(type,data)=>controller.enqueue(encode.encode(`event: ${type}\ndata: ${JSON.stringify({...data,type})}\n\n`));
  return{get aborted(){return aborted;},async fetch(url,options){
    options.signal.addEventListener('abort',()=>{aborted=true;try{controller.error(new Error('aborted'));}catch{}},{once:true});
    assert.equal(JSON.parse(options.body).stream,true);
    emit('message_start',{message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:1000,output_tokens:0}}});
    emit('content_block_start',{index:0,content_block:{type:'text',text:''}});
    emit('content_block_delta',{index:0,delta:{type:'text_delta',text:'live reply'}});
    return new Response(stream,{headers:{'content-type':'text/event-stream'}});
  },finish(){
    emit('content_block_stop',{index:0});
    emit('message_delta',{delta:{stop_reason:'end_turn'},usage:{input_tokens:20,output_tokens:5,cache_read_input_tokens:30}});
    emit('message_stop',{});controller.close();
  }};
}
const waitFor=async check=>{const start=Date.now();while(!check()){if(Date.now()-start>2000)throw new Error('checkpoint timeout');await new Promise(r=>setTimeout(r,2));}};

test('Large MCP result survives the full messages handler and the next tool call is returned',async t=>{
  environment(t);const {state,db}=ledger();
  const result='Scene mesh vertices and materials. '.repeat(20000);
  const request={...body(),tools:[{name:'mcp__blender__execute_code',description:'Run Blender Python',input_schema:{type:'object',properties:{code:{type:'string'}}}}],
    messages:[{role:'user',content:'Build the model in Blender'},
    {role:'assistant',content:[{type:'tool_use',id:'scene_1',name:'mcp__blender__execute_code',input:{code:'inspect_scene()'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'scene_1',content:result}]}]};
  const handler=createMessagesHandler({getDatabase:()=>db,verifyPrices:async()=>({ready:true}),providerFetch:async(url,options)=>{
    const sent=JSON.parse(options.body);
    assert.equal(sent.messages[2].content[0].content,result);
    assert.equal(sent.tools[0].name,'mcp__blender__execute_code');
    return Response.json({type:'message',content:[{type:'tool_use',id:'build_1',name:'mcp__blender__execute_code',input:{code:'build_model()'}}],stop_reason:'tool_use',usage:{input_tokens:1000,output_tokens:30}});
  }});
  const response=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers,body:JSON.stringify(request)}));
  assert.equal(response.status,200);
  const events=await response.text();assert.match(events,/build_model/);assert.match(events,/"stop_reason":"tool_use"/);
  assert.equal(state.debits.length,1);assert.equal(state.disabled,false);
});

test('Live text arrives before final billing; periodic pending checkpoints do not double-charge cumulative usage',async t=>{
  environment(t);const {state,db}=ledger(),upstream=provider();
  const handler=createMessagesHandler({getDatabase:()=>db,verifyPrices:async()=>({ready:true}),providerFetch:upstream.fetch,checkpointIntervalMs:10});
  const response=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers,body:JSON.stringify(body())}));
  assert.equal(response.status,200);
  const reader=response.body.getReader();const first=await reader.read();
  assert.ok(new TextDecoder().decode(first.value).includes('message_start'));
  assert.equal(state.debits.length,0);
  await waitFor(()=>state.checkpoints.length>=3);
  assert.ok(state.checkpoints.every(n=>n>=0&&n<=state.held));
  upstream.finish();let result='';while(true){const part=await reader.read();if(part.done)break;result+=new TextDecoder().decode(part.value);}
  assert.match(result,/live reply/);assert.match(result,/message_stop/);
  assert.deepEqual(state.debits,[-732]); // final replaces the larger start snapshot
  assert.equal(state.status,'settled');
});
test('Revocation is detected during generation and cancels the provider stream',async t=>{
  environment(t);const {state,db}=ledger(),upstream=provider();
  const handler=createMessagesHandler({getDatabase:()=>db,verifyPrices:async()=>({ready:true}),providerFetch:upstream.fetch,checkpointIntervalMs:10});
  const response=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers,body:JSON.stringify(body())}));
  await waitFor(()=>state.checkpoints.length>=2);state.disabled=true;
  const text=await response.text();assert.match(text,/event: error/);
  assert.equal(upstream.aborted,true);assert.equal(state.status,'held');assert.equal(state.debits.length,0);
});
test('Remaining credits shorten max_tokens instead of rejecting an affordable shorter completion',async t=>{
  environment(t);const prepared=prepareRequest(body()),count=countInput(prepared.upstream);
  const inputCredits=inputReservation(Math.min(prepared.inputTokens,count.inputTokens));
  const {state,db}=ledger(BigInt(inputCredits+3*72));let authorized;
  const handler=createMessagesHandler({getDatabase:()=>db,verifyPrices:async()=>({ready:true}),providerFetch:async(url,options)=>{
    authorized=JSON.parse(options.body).max_tokens;
    return Response.json({type:'message',content:[{type:'text',text:'ok'}],usage:{input_tokens:1,output_tokens:3},stop_reason:'max_tokens'});
  }});
  const request=()=>new Request('https://gateway.test/v1/messages',{method:'POST',headers,body:JSON.stringify({...body(),stream:false})});
  assert.equal((await handler(request())).status,200);assert.equal(authorized,3);assert.ok(state.balance>=0n);
  state.status=null;
  assert.equal((await handler(request())).status,402);
});
test('Customer with 2M credits can afford the desktop prompt that byte reservation incorrectly blocked',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/request-bound-reference.json',import.meta.url),'utf8'));
  const prepared=prepareRequest(fixture.cases.at(-1).body),count=countInput(prepared.upstream);
  assert.ok(requestReservation(prepared.inputTokens,4096)>2000000);
  assert.ok(requestReservation(count.inputTokens,4096)<2000000);
});
test('Client cancellation aborts live generation without inventing a final charge',async t=>{
  environment(t);const {state,db}=ledger(),upstream=provider();
  const handler=createMessagesHandler({getDatabase:()=>db,verifyPrices:async()=>({ready:true}),providerFetch:upstream.fetch,checkpointIntervalMs:10});
  const response=await handler(new Request('https://gateway.test/v1/messages',{method:'POST',headers,body:JSON.stringify(body())}));
  await waitFor(()=>state.checkpoints.length>=2);await response.body.cancel();
  await waitFor(()=>upstream.aborted);
  assert.equal(state.debits.length,0);assert.equal(state.status,'held');
});
