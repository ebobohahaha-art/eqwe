import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountClient } from '../public/account-client.mjs';

const key = `sk-gw-${'a'.repeat(64)}`;
const account = { customer: { id: 'test', name: 'Customer' }, tokens: { granted: '10000000', used: '10', remaining: '9999990' }, inferenceEnabled: true };
test('Customer login uses only the same-origin account service with the correct auth header', async () => {
  let calls = 0;
  const client = createAccountClient({ origin: 'https://gateway.example', fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://gateway.example/api/account');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return Response.json(account);
  } });
  assert.equal(client.authenticated, false);
  const result = await client.signIn(key);
  assert.equal(result.tokens.reserved, '0');
  assert.equal(client.authenticated, true);
  assert.equal(client.keySuffix, 'aaaa');
  await client.refresh();
  assert.equal(calls, 2);
  client.signOut();
  assert.equal(client.authenticated, false);
  assert.equal(client.account, null);
  assert.equal(client.keySuffix, '');
  assert.equal(await client.refresh(), null);
  assert.equal(calls, 2);
});
test('HTTP previews and malformed keys cannot send credentials', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('must not call'); };
  await assert.rejects(createAccountClient({ origin: 'http://127.0.0.1', fetch: request }).signIn(key), /HTTPS/);
  await assert.rejects(createAccountClient({ origin: 'https://gateway.example', fetch: request }).signIn('provider-key'), /customer key/);
  assert.equal(calls, 0);
});
test('Invalid account responses and revoked keys cannot unlock the workspace', async () => {
  for (const response of [Response.json({ valid: true }), Response.json({ ...account, tokens: { ...account.tokens, used: 'NaN' } }), Response.json({}, { status: 401 })]) {
    const client = createAccountClient({ origin: 'https://gateway.example', fetch: async () => response });
    await assert.rejects(client.signIn(key));
    assert.equal(client.authenticated, false);
    assert.equal(client.account, null);
  }
});
test('Revocation clears the session; transient failures retain the last known balance', async () => {
  let next = () => Response.json(account);
  const client = createAccountClient({ origin: 'https://gateway.example', fetch: async () => next() });
  await client.signIn(key);
  next = () => Response.json({}, { status: 503 });
  await assert.rejects(client.refresh());
  assert.equal(client.authenticated, true);
  assert.equal(client.account.tokens.remaining, '9999990');
  next = () => Response.json({}, { status: 401 });
  await assert.rejects(client.refresh());
  assert.equal(client.authenticated, false);
  assert.equal(client.account, null);
});
test('A late sign-in response cannot resurrect a signed-out session', async () => {
  let resolve;
  const client = createAccountClient({ origin: 'https://gateway.example', fetch: () => new Promise(done => { resolve = done; }) });
  const pending = client.signIn(key);
  client.signOut();
  resolve(Response.json(account));
  await assert.rejects(pending, error => error.code === 'SESSION_CANCELLED');
  assert.equal(client.authenticated, false);
});
