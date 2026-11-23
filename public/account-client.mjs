// Customer sign-in may be remembered on this browser for a fixed seven days.
const SESSION_NAME = "gateway.customer-session.v1";
const WEEK = 7 * 24 * 60 * 60 * 1000;
export class AccountError extends Error {
  constructor(message, status = 0, code = 'ACCOUNT_ERROR') {
    super(message); this.name = 'AccountError'; this.status = status; this.code = code;
  }
}

export function parseAccount(value) {
  if (!value || typeof value.customer?.id !== 'string' || !value.customer.id ||
      typeof value.customer.name !== 'string' || !value.tokens) {
    throw new AccountError('The account service returned an invalid response.');
  }
  const tokens = {};
  for (const field of ['granted', 'used', 'remaining', 'reserved', 'pending']) {
    const amount = value.tokens[field] ?? (['reserved', 'pending'].includes(field) ? '0' : undefined);
    if (!/^-?\d+$/.test(String(amount))) throw new AccountError('The account service returned an invalid balance.');
    tokens[field] = String(amount);
  }
  return {
    customer: { id: value.customer.id, name: value.customer.name }, tokens,
    inferenceEnabled: value.inferenceEnabled === true,
    serviceStatus: { message: typeof value.serviceStatus?.message === 'string' ? value.serviceStatus.message : 'Inference is currently unavailable.' },
  };
}

export function createAccountClient({ origin, fetch: request = globalThis.fetch, storage = null, now = Date.now }) {
  const base = new URL(origin);
  const endpoint = new URL('/api/account', base).href;
  let key = '', epoch = 0, account = null, expiresAt = 0;
  const forget = () => { try { storage?.removeItem(SESSION_NAME); } catch {} };
  const clear = () => { epoch++; key = ''; account = null; expiresAt = 0; forget(); };
  const save = () => { try { storage?.setItem(SESSION_NAME, JSON.stringify({key, expiresAt})); } catch {} };
  const expired = () => expiresAt > 0 && now() >= expiresAt;
  async function read(customerKey) {
    if (base.protocol !== 'https:') throw new AccountError('Customer sign-in requires HTTPS. Open your HTTPS gateway site.');
    const response = await request(endpoint, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${customerKey}` },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new AccountError('This customer key is invalid or has been revoked.', response.status);
      if (response.status === 429) throw new AccountError('Too many account requests. Please try again shortly.', 429);
      throw new AccountError('The account service is unavailable. Please try again shortly.', response.status);
    }
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new AccountError('The account endpoint did not return JSON. Check this deployment.');
    }
    let data;
    try { data = await response.json(); } catch { throw new AccountError('The account service returned invalid JSON.'); }
    return parseAccount(data);
  }
  return {
    get authenticated() { return Boolean(key) && !expired(); },
    get keySuffix() { return key.slice(-4); },
    get account() { return account; },
    async signIn(input) {
      clear();
      const candidate = input.trim();
      if (!/^sk-gw-[a-f0-9]{64}$/.test(candidate)) throw new AccountError('Paste your complete customer key, not a provider key.');
      const attempt = epoch;
      const result = await read(candidate);
      if (attempt !== epoch) throw new AccountError('Sign-in was cancelled.', 0, 'SESSION_CANCELLED');
      key = candidate; account = result; expiresAt = now() + WEEK; save();
      return result;
    },
    async restore() {
      if (base.protocol !== 'https:') { forget(); return null; }
      let saved;
      try { saved = JSON.parse(storage?.getItem(SESSION_NAME) ?? 'null'); } catch { forget(); return null; }
      if (!saved) return null;
      if (!/^sk-gw-[a-f0-9]{64}$/.test(saved.key) || !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt <= now() || saved.expiresAt > now() + WEEK) { clear(); return null; }
      const attempt = epoch;
      let result;
      try { result = await read(saved.key); }
      catch (error) { if ([401, 403].includes(error.status) && attempt === epoch) clear(); throw error; }
      if (attempt !== epoch) return null;
      key = saved.key; expiresAt = saved.expiresAt; account = result;
      return result;
    },
    async refresh() {
      if (expired()) { clear(); throw new AccountError('Your seven-day sign-in expired. Please enter your customer key again.', 401); }
      if (!key) return null;
      const attempt = epoch;
      try {
        const result = await read(key);
        if (attempt !== epoch) return null;
        account = result;
        return result;
      } catch (error) {
        if (attempt !== epoch) return null;
        if ([401, 403].includes(error.status)) clear();
        throw error;
      }
    },
    async usage() {
      if (!key || expired()) { clear(); throw new AccountError('Sign in again.',401); }
      const attempt=epoch;
      const response=await request(new URL('/api/account?view=usage',base).href,{headers:{Authorization:`Bearer ${key}`},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(attempt!==epoch)return null;
      if([401,403].includes(response.status)){clear();throw new AccountError('Sign in again.',401);}
      if(!response.ok)throw new AccountError('Could not load usage.',response.status);
      const data=await response.json();
      return attempt===epoch?data:null;
    },
    async chat(messages) {
      if(!key || expired()){clear();throw new AccountError('Sign in again.',401);}
      const attempt=epoch;
      // Never attach tools, project instructions, or global memory to simple chat.
      const response=await request(new URL('/v1/messages',base).href,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({model:'gateway-chat',max_tokens:512,stream:false,messages})});
      const data=await response.json();
      if(attempt!==epoch)throw new AccountError('Session ended.',0,'SESSION_CANCELLED');
      if([401,403].includes(response.status))clear();
      if(!response.ok)throw new AccountError(data.error?.message || 'Chat request failed.',response.status);
      const answer=data.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      if(typeof answer!=='string')throw new AccountError('Invalid chat response.');
      return answer;
    },
    signOut: clear,
  };
}
