import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPriceVerifier, parseProviderPrices } from '../lib/provider-prices.mjs';
const fixture=readFileSync(new URL('./fixtures/deepseek-pricing.html',import.meta.url),'utf8');

test('Official price table parses peak Flash prices, not off-peak or Pro prices',()=>{
  assert.deepEqual(parseProviderPrices(fixture),{modelVersion:'DeepSeek-V4.1-Flash-1017',cache:6,input:300,output:1200});
  for(const page of ['',fixture.replace('CACHE MISS','UNKNOWN RATE'),fixture+fixture,fixture.replace('$0.3','FREE')]) {
    assert.throws(()=>parseProviderPrices(page));
  }
});
test('Automatic verification coalesces requests, expires, and fails closed on tariff/model/network changes',async()=>{
  let time=1000000,calls=0,page=fixture,offline=false;
  const verify=createPriceVerifier({now:()=>time,fetchPage:async(url,options)=>{
    calls++; assert.equal(url,'https://api-docs.deepseek.com/quick_start/pricing/');
    assert.equal(options.redirect,'error');
    if(offline)throw new Error('offline');
    return new Response(page);
  }});
  const results=await Promise.all([verify(),verify(),verify()]);
  assert.ok(results.every(r=>r.ready)); assert.equal(calls,1);
  time+=299000; assert.equal((await verify()).ready,true); assert.equal(calls,1);
  time+=2000; page=fixture.replace('$0.3','$0.9');
  assert.equal((await verify()).ready,false); assert.equal(calls,2);
  time+=16000; page=fixture.replace('DeepSeek-V4.1-Flash-1017','New-Model');
  assert.equal((await verify()).ready,false);
  time+=16000; offline=true;
  assert.equal((await verify()).ready,false);
  time+=16000; offline=false; page=fixture;
  assert.equal((await verify()).ready,true);
});
test('Malformed, oversized and failed price responses never authorize inference',async()=>{
  for(const fetchPage of [async()=>new Response('rate limit',{status:429}),async()=>new Response('X'.repeat(1000001)),async()=>new Response('<html>changed table</html>')]) {
    assert.equal((await createPriceVerifier({fetchPage})()).ready,false);
  }
});
