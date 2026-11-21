import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vercelHandler} from '../lib/vercel-handler.mjs';
import {vercelOrigin} from '../scripts/vercel-origin.mjs';
import account from '../api/account.mjs';
import admin from '../api/admin.mjs';
import messages from '../api/messages.mjs';
import countTokens from '../api/count-tokens.mjs';
import health from '../api/health.mjs';

test('Vercel selects the right connector domain and refuses unsafe or missing origins',()=>{
  assert.equal(vercelOrigin({VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'production.vercel.app',VERCEL_URL:'hash.vercel.app'}),'https://production.vercel.app');
  assert.equal(vercelOrigin({VERCEL_ENV:'preview',VERCEL_PROJECT_PRODUCTION_URL:'production.vercel.app',VERCEL_URL:'preview.vercel.app'}),'https://preview.vercel.app');
  assert.equal(vercelOrigin({PUBLIC_ORIGIN:'https://custom.example/'}),'https://custom.example');
  for(const value of ['http://site.test','https://name:password@site.test','https://site.test/path','https://site.test/?token=x'])assert.throws(()=>vercelOrigin({PUBLIC_ORIGIN:value}));
  assert.throws(()=>vercelOrigin({}),/PUBLIC_ORIGIN/);
});
test('Vercel preserves streamed tool events before completion and passes cancellation through',async()=>{
  const aborter=new AbortController();let finish;
  const handler=vercelHandler(request=>{
    assert.equal(request.signal.aborted,false);
    request.signal.addEventListener('abort',()=>finish.error(new Error('cancelled')),{once:true});
    return new Response(new ReadableStream({start(controller){finish=controller;controller.enqueue(new TextEncoder().encode('event: content_block_start\ndata: {"type":"tool_use"}\n\n'));}}),{headers:{'content-type':'text/event-stream','X-Gateway-Request-ID':'test'}});
  });
  const response=await handler(new Request('https://site.vercel.app/v1/messages',{signal:aborter.signal}));
  assert.equal(response.headers.get('X-Gateway-Request-ID'),'test');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/tool_use/);
  aborter.abort();await assert.rejects(reader.read(),/cancelled/);
});
test('All Vercel entries route to authenticated handlers and health identifies deployment',async()=>{
  for(const [entry,path] of [[account,'/api/account'],[admin,'/api/admin'],[messages,'/v1/messages'],[countTokens,'/v1/messages/count_tokens']]){
    const response=await entry.fetch(new Request('https://site.vercel.app'+path,{method:path==='/api/account'||path==='/api/admin'?'GET':'POST',body:path.includes('/v1/')?'{}':undefined}));
    assert.ok([401,503].includes(response.status),path+': '+response.status);
    assert.equal(response.headers.get('X-Gateway-Release'),'vercel-v1');
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  const response=await health.fetch(new Request('https://site.vercel.app/api/health'));
  assert.equal((await response.json()).release,'vercel-v1');
});
test('Vercel deployment only publishes public files, includes tokenizer and routes API paths',()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)));
  assert.equal(config.outputDirectory,'public');
  assert.equal(config.functions['api/*.mjs'].includeFiles,'lib/assets/**');
  assert.equal(config.functions['api/*.mjs'].supportsCancellation,true);
  for(const path of ['/admin','/v1/messages','/v1/messages/count_tokens'])assert.ok(config.rewrites.some(row=>row.source===path));
});
