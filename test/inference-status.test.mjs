import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferenceStatus } from '../lib/inference-status.mjs';
import { CREDIT_POLICY } from '../lib/credit-pricing.mjs';
import admin from '../netlify/functions/admin.mjs';

test('Readiness identifies every missing setting and redacts credential values', () => {
  const now=Date.parse('2026-11-20T12:00:00Z');
  const missing=inferenceStatus({},now);
  assert.equal(missing.ready,false);
  assert.deepEqual(missing.issues.map(i=>i.code),['SERVICE_DISABLED','PROVIDER_MISSING','CREDIT_POLICY_MISSING','PRICING_REVIEW_REQUIRED','REQUEST_BOUND_MISSING']);
  const env={INFERENCE_ENABLED:'true',DEEPSEEK_API_KEY:'dummy-secret-not-for-output',CREDIT_POLICY,PROVIDER_PRICING_VERIFIED_AT:'2026-11-20T11:00:00Z',MAX_PROVIDER_REQUEST_TOKENS:'100000'};
  const ready=inferenceStatus(env,now);
  assert.equal(ready.ready,true);
  assert.equal(ready.requiredReservationCredits,7200000);
  assert.ok(!JSON.stringify(ready).includes(env.DEEPSEEK_API_KEY));
  const expired=inferenceStatus({...env,PROVIDER_PRICING_VERIFIED_AT:'2026-11-18T11:00:00Z'},now);
  assert.equal(expired.code,'PRICING_REVIEW_REQUIRED');
  assert.equal(inferenceStatus({...env,MAX_PROVIDER_REQUEST_TOKENS:String(Number.MAX_SAFE_INTEGER)},now).code,'REQUEST_BOUND_MISSING');
});

test('Administrator can diagnose configuration without a database connection; customers cannot',async()=>{
  const names=['ADMIN_ACCESS_KEY','DATABASE_URL'];
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const key=`sk-admin-${'a'.repeat(64)}`;
  try {
    process.env.ADMIN_ACCESS_KEY=key; delete process.env.DATABASE_URL;
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
