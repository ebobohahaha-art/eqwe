// Customer credentials exist only in this session closure. Never persist them.
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

export function createAccountClient({ origin, fetch: request = globalThis.fetch }) {
  const base = new URL(origin);
  const endpoint = new URL('/api/account', base).href;
  let key = '', epoch = 0, account = null;
  const clear = () => { epoch++; key = ''; account = null; };
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
    get authenticated() { return Boolean(key); },
    get keySuffix() { return key.slice(-4); },
    get account() { return account; },
    async signIn(input) {
      clear();
      const candidate = input.trim();
      if (!/^sk-gw-[a-f0-9]{64}$/.test(candidate)) throw new AccountError('Paste your complete customer key, not a provider key.');
      const attempt = epoch;
      const result = await read(candidate);
      if (attempt !== epoch) throw new AccountError('Sign-in was cancelled.', 0, 'SESSION_CANCELLED');
      key = candidate; account = result;
      return result;
    },
    async refresh() {
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
    signOut: clear,
  };
}
