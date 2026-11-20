import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferenceStatus } from '../lib/inference-status.mjs';
import { CREDIT_POLICY } from '../lib/credit-pricing.mjs';
import admin from '../netlify/functions/admin.mjs';

test('Readiness uses built-in request limits and automatic price checks without manual timestamps', async () => {
  const verifyPrices=async()=>({ready:true,checkedAt:Date.parse('2026-11-20T12:00:00Z')});
  const missing=await inferenceStatus({},{verifyPrices});
  assert.equal(missing.ready,false);
  assert.deepEqual(missing.issues.map(i=>i.code),['SERVICE_DISABLED','PROVIDER_MISSING']);
  const env={INFERENCE_ENABLED:'true',DEEPSEEK_API_KEY:'dummy-secret-not-for-output'};
  const ready=await inferenceStatus(env,{verifyPrices});
  assert.equal(ready.ready,true);
  assert.equal(ready.limits.inputTokens,500000);
  assert.ok(!JSON.stringify(ready).includes(env.DEEPSEEK_API_KEY));
  const unavailable=await inferenceStatus(env,{verifyPrices:async()=>({ready:false})});
  assert.equal(unavailable.code,'PROVIDER_PRICE_CHECK_FAILED');
  assert.equal((await inferenceStatus({...env,CREDIT_POLICY:'wrong'},{verifyPrices})).code,'CREDIT_POLICY_UNSUPPORTED');
  assert.equal((await inferenceStatus({...env,PROVIDER_PRICING_VERIFIED_AT:'invalid',MAX_PROVIDER_REQUEST_TOKENS:'1'},{verifyPrices})).ready,true);
});

test('Administrator can diagnose configuration without a database connection; customers cannot',async()=>{
  const names=['ADMIN_ACCESS_KEY','DATABASE_URL','INFERENCE_ENABLED'];
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const key=`sk-admin-${'a'.repeat(64)}`;
  try {
    process.env.ADMIN_ACCESS_KEY=key; delete process.env.DATABASE_URL; process.env.INFERENCE_ENABLED='false';
    const url='https://example.test/api/admin?view=readiness';
    assert.equal((await admin(new Request(url))).status,401);
    const response=await admin(new Request(url,{headers:{Authorization:`Bearer ${key}`}}));
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.databaseConfigured,false);
    assert.ok(Array.isArray(body.inference.issues));
    assert.ok(!JSON.stringify(body).includes(key));
  } finally {for(const n of names){if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}}
});
