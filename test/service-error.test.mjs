import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serviceError} from '../lib/service-error.mjs';
test('Database diagnostics identify errors without exposing credentials or raw errors',()=>{
 for(const [code,expected] of [['28P01','DATABASE_AUTH_FAILED'],['53300','DATABASE_CONNECTION_LIMIT'],['42501','DATABASE_PERMISSION_DENIED'],['SELF_SIGNED_CERT_IN_CHAIN','DATABASE_TLS_FAILED']]){
  const result=serviceError({code,message:'secret password host query'},'reservation');assert.equal(result.code,expected);assert.doesNotMatch(JSON.stringify(result),/secret|password|host query/);
 }
 assert.equal(serviceError({message:'database_not_configured'},'reservation').code,'DATABASE_NOT_CONFIGURED');
 assert.equal(serviceError(new Error('private stack and credentials'),'reservation').code,'DATABASE_OPERATION_FAILED');
 assert.equal(serviceError(new Error('private'),'tokenizer').code,'INPUT_TOKENIZER_FAILED');
});

test('Legacy reservation uniqueness error identifies the missing concurrency migration',()=>{
 const result=serviceError({code:'23505',constraint:'one_unsettled_request_per_customer',detail:'private database detail'},'reservation');
 assert.equal(result.code,'DATABASE_CONCURRENCY_MIGRATION_REQUIRED');
 assert.doesNotMatch(JSON.stringify(result),/private database detail/);
});
