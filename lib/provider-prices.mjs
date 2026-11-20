export const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing/';
export const SUPPORTED_MODEL_VERSION = 'DeepSeek-V4.1-Flash-1017';
export const PRICE_BOUNDS = Object.freeze({ input: 360, cache: 8, output: 1440 });
const FRESH_MS = 5 * 60 * 1000;

function plain(html) {
  return html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function parseProviderPrices(html) {
  // Expand rowspans/colspans before indexing the Flash column. Never accidentally
  // use the adjacent Pro prices or treat off-peak prices as the peak ceiling.
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  const matches = [];
  for (const [, table] of tables) {
    const grid = [];
    let r = 0;
    for (const [, row] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      grid[r] ??= [];
      let col = 0;
      for (const [, attrs, content] of row.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
        while (grid[r][col] !== undefined) col++;
        const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1);
        const rows = Number(/rowspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1);
        if (span > 16 || rows > 32 || span < 1 || rows < 1 || col > 32 || r > 128) throw new Error('Unexpected provider price table');
        for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < span; dc++) {
          grid[r + dr] ??= []; grid[r + dr][col + dc] = plain(content);
        }
        col += span;
      }
      r++;
    }
    const header = grid.find(row => row.some(cell => cell === 'MODEL'));
    const flash = header?.indexOf('deepseek-flash') ?? -1;
    if (flash < 0) continue;
    const version = grid.find(row => row.some(cell => cell === 'MODEL VERSION'))?.[flash];
    const result = { modelVersion: version };
    for (const row of grid) {
      if (!row.includes('PEAK') || !row.some(c => /^PRICING$/.test(c))) continue;
      const match = /^\$(\d+(?:\.\d{1,6})?)$/.exec(row[flash] ?? '');
      if (!match) throw new Error('Provider rate is not a recognized USD price');
      // USD per million tokens -> nanodollars per token. Round upward.
      const rate = Math.ceil(Number(match[1]) * 1000);
      if (row.some(c => c.includes('CACHE HIT'))) result.cache = rate;
      else if (row.some(c => c.includes('CACHE MISS'))) result.input = rate;
      else if (row.some(c => c.includes('OUTPUT TOKENS'))) result.output = rate;
    }
    matches.push(result);
  }
  if (matches.length !== 1 || !['input', 'cache', 'output'].every(k => Number.isSafeInteger(matches[0][k]) && matches[0][k] > 0)) {
    throw new Error('Cannot identify all peak Flash rates');
  }
  return matches[0];
}

export function createPriceVerifier({ fetchPage = (...args) => fetch(...args), now = Date.now } = {}) {
  let cached, pending;
  return async function verifiedPrices() {
    if (cached && now() - cached.checkedAt < FRESH_MS && now() >= cached.checkedAt) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchPage(PRICING_URL, { redirect: 'error', signal: AbortSignal.timeout(6000), headers: { accept: 'text/html' } });
        if (!response.ok) throw new Error('Price page unavailable');
        const reader = response.body.getReader(); let size = 0; const chunks = [];
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 1000000) { await reader.cancel(); throw new Error('Price page too large'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        const prices = parseProviderPrices(Buffer.concat(chunks).toString('utf8'));
        if (prices.modelVersion !== SUPPORTED_MODEL_VERSION) throw new Error('Provider model version changed');
        for (const key of ['input', 'cache', 'output']) if (prices[key] > PRICE_BOUNDS[key]) throw new Error('Provider tariff exceeds configured cost bounds');
        cached = { ready: true, code: 'VERIFIED', checkedAt: now(), modelVersion: prices.modelVersion };
      } catch {
        // No timestamp override or stale-success fallback. Short failure cache
        // avoids repeated cold calls during an outage without authorizing spend.
        cached = { ready: false, code: 'PROVIDER_PRICE_CHECK_FAILED', checkedAt: now() - FRESH_MS + 15000 };
      }
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
export const verifiedProviderPrices = createPriceVerifier();
