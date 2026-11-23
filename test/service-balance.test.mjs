import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatUSD,usdToUnits} from '../public/service-balance.mjs';
import {createAccountClient} from '../public/account-client.mjs';
test('Service USD conversion preserves existing budgets and tiny debits exactly',()=>{
 assert.equal(formatUSD('10000000'),'$10.00');assert.equal(formatUSD('100000000'),'$100.00');
 assert.equal(formatUSD('1'),'$0.000001');assert.equal(formatUSD('9999999'),'$9.999999');
 assert.equal(formatUSD('-1234567'),'-$1.234567');assert.equal(usdToUnits('10.25'),'10250000');
 for(const bad of ['0','-1','1e3','1.001','1000.01','NaN'])assert.throws(()=>usdToUnits(bad));
});
test('Simple chat authenticates to same origin and omits desktop context and tools',async()=>{
 const key=`sk-gw-${'a'.repeat(64)}`;let calls=0;
 const client=createAccountClient({origin:'https://gateway.example',fetch:async(url,options)=>{
  calls++;assert.equal(options.headers.Authorization,`Bearer ${key}`);
  if(url.endsWith('/api/account'))return Response.json({customer:{id:'id',name:'Customer'},tokens:{granted:'10000000',used:'0',remaining:'10000000'}});
  assert.equal(url,'https://gateway.example/v1/messages');
  assert.equal(options.redirect,'error');const body=JSON.parse(options.body);
  assert.equal(body.max_tokens,512);assert.equal(body.stream,false);assert.equal(body.tools,undefined);assert.equal(body.system,undefined);
  assert.deepEqual(body.messages,[{role:'user',content:'hello'}]);
  return Response.json({content:[{type:'text',text:'Hello!'}]});
 }});
 await client.signIn(key);assert.equal(await client.chat([{role:'user',content:'hello'}]),'Hello!');assert.equal(calls,2);
 client.signOut();await assert.rejects(client.chat([{role:'user',content:'hello'}]),/Sign in/);assert.equal(calls,2);
});

test('New USD usage is authenticated, scoped to this customer, and excludes prior usage',async()=>{
 const {createAccountHandler}=await import('../netlify/functions/account.mjs');
 let calls=0;
 const handler=createAccountHandler({getDatabase:()=>({query:async(sql,args)=>{
  calls++;
  if(calls===1)return {rows:[{id:'customer-123',name:'Name',granted:'10000000',used:'1',remaining:'9999999',reserved:'0',pending:'0'}]};
  assert.match(sql,/customer_id=\$1/);assert.match(sql,/created_at >= \$2/);assert.equal(args[0],'customer-123');
  assert.ok(Number.isFinite(Date.parse(args[1])));
  return {rows:[{request_id:'request-1',created_at:'2026-11-23T00:00:00Z',units:'1'}]};
 }}),getReadiness:()=>{throw new Error('Usage must not check pricing or call provider');}});
 const response=await handler(new Request('https://gateway.example/api/account?view=usage',{headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`}}));
 assert.equal(response.status,200);assert.equal((await response.json()).events[0].units,'1');assert.equal(calls,2);
 const denied=await handler(new Request('https://gateway.example/api/account?view=usage'));
 assert.equal(denied.status,401);assert.equal(calls,2);
});


test('USD update keeps normal account balances readable',async()=>{
 const {createAccountHandler}=await import('../netlify/functions/account.mjs');
 const handler=createAccountHandler({getDatabase:()=>({query:async()=>({rows:[{id:'id',name:'Customer',granted:'10000000',used:'0',remaining:'10000000',reserved:'0',pending:'0'}]})}),getReadiness:async()=>({ready:true})});
 const response=await handler(new Request('https://gateway.example/api/account',{headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`}}));
 assert.equal(response.status,200);assert.equal((await response.json()).tokens.remaining,'10000000');
});
