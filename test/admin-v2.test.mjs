import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../netlify/functions/admin.mjs';
import {listOptions} from '../lib/admin-queries.mjs';
const key=`sk-admin-${'a'.repeat(64)}`,id='11111111-1111-4111-8111-111111111111';
const customer={id,name:'Customer',disabled:false,granted:'10000000',used:'100',reserved:'50',pending:'10',remaining:'9999850'};
function req(query='',body){return new Request('https://admin.test/api/admin'+query,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body?{Origin:'https://admin.test','Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
function auth(t){const old=process.env.ADMIN_ACCESS_KEY;process.env.ADMIN_ACCESS_KEY=key;t.after(()=>{if(old===undefined)delete process.env.ADMIN_ACCESS_KEY;else process.env.ADMIN_ACCESS_KEY=old;});}
test('Admin pagination binds literal search/filter/limits; sort input cannot enter SQL',async t=>{
 auth(t);const calls=[];
 const handler=createAdminHandler({readiness:async()=>({ready:true,issues:[]}),db:()=>({query:async(sql,values)=>{calls.push({sql,values});if(sql.includes('LIMIT 0'))return{rows:[]};if(sql.includes('COUNT(*)::int AS total'))return{rows:[{total:80,active:80,revoked:0,granted:'80',used:'0',remaining:'80',reserved:'0'}]};return{rows:[customer]};}})});
 const response=await handler(req('?search=%25quoted%27&status=active&sort=balance_low&page=3&limit=25'));
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.page,3);assert.equal(data.total,80);assert.equal(data.customers[0].id,id);
 const list=calls.at(-1);assert.deepEqual(list.values,["%quoted'",'active',25,50]);assert.match(list.sql,/ORDER BY remaining ASC,id ASC LIMIT \$3 OFFSET \$4/);assert.ok(!list.sql.includes("%quoted'"));assert.doesNotMatch(list.sql,/key_hash/);
 for(const query of ['?page=0','?limit=101','?sort=constructor','?sort=DROP%20TABLE','?status=invalid'])assert.throws(()=>listOptions(new URL('https://admin.test/'+query)));
});
test('Customer history is admin-only, scoped to one ID, and does not query plaintext keys',async t=>{
 auth(t);const calls=[];const handler=createAdminHandler({db:()=>({query:async(sql,values)=>{calls.push({sql,values});if(sql.includes('LIMIT 0'))return{rows:[]};if(sql.includes('FROM balances WHERE id='))return{rows:[customer]};return{rows:[]};}})});
 const data=await(await handler(req('?view=customer&id='+id))).json();assert.equal(data.customer.id,id);assert.deepEqual(data.events,[]);assert.deepEqual(data.audit,[]);assert.deepEqual(data.reservations,[]);
 for(const c of calls.slice(2)){assert.deepEqual(c.values,[id]);assert.doesNotMatch(c.sql,/key_hash/);}
 assert.equal((await handler(req('?view=customer&id=not-a-uuid'))).status,400);
 const wrong=new Request('https://admin.test/api/admin?view=customer&id='+id,{headers:{Authorization:`Bearer sk-gw-${'b'.repeat(64)}`}});const before=calls.length;assert.equal((await handler(wrong)).status,401);assert.equal(calls.length,before);
});
test('Credit grant transaction and duplicate operation protection survive admin upgrade',async t=>{
 auth(t);const calls=[];let duplicate=false;
 const handler=createAdminHandler({db:()=>({connect:async()=>({query:async(sql,values)=>{calls.push({sql,values});if(sql.includes('INSERT INTO admin_audit'))return{rowCount:duplicate?0:1};if(sql.startsWith('SELECT disabled'))return{rowCount:1,rows:[{disabled:false}]};return{rowCount:1,rows:[]};},release(){}})})});
 const body={action:'grant',customerId:id,tokens:'500',reason:'Purchase 123',operationId:'22222222-2222-4222-8222-222222222222'};
 assert.equal((await handler(req('',body))).status,200);assert.ok(calls.some(c=>c.sql==='COMMIT'));assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO token_events')).length,1);
 duplicate=true;assert.equal((await handler(req('',body))).status,409);assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO token_events')).length,1);assert.equal(calls.at(-1).sql,'ROLLBACK');
});
test('Failed admin credit writes roll back and return only sanitized diagnostics',async t=>{
 auth(t);const calls=[];const handler=createAdminHandler({db:()=>({connect:async()=>({query:async(sql)=>{calls.push(sql);if(sql.includes('INSERT INTO admin_audit'))return{rowCount:1};if(sql.startsWith('SELECT disabled'))return{rowCount:1,rows:[{disabled:false}]};if(sql.includes('INSERT INTO token_events'))throw Object.assign(new Error('secret database details'),{code:'XX000'});return{rows:[]};},release(){}})})});
 const response=await handler(req('',{action:'grant',customerId:id,tokens:'50',reason:'Order 456',operationId:'33333333-3333-4333-8333-333333333333'}));assert.equal(response.status,503);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));assert.doesNotMatch(await response.text(),/secret database details/);
});
