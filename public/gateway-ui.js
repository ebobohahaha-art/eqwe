import { createAccountClient } from '/account-client.mjs';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const client = createAccountClient({ origin: location.origin });
const gatewayOrigin = location.protocol === 'https:' ? location.origin : 'https://oopengate.vercel.app';
let pendingRoute = 'customer', signingIn = false, refreshing = false;
let previousFocus = null, toastTimer;

$('#api-base-url').value = gatewayOrigin;
$('#gateway-url').textContent = gatewayOrigin;
for (const element of $$('[data-pixel]')) element.textContent = element.dataset.pixel;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2500);
}
function setError(message) {
  $('#login-error').textContent = message;
  $('#login-error').hidden = !message;
}
function closeTutorial() {
  $('#float-layer').hidden = true;
  $('#tutorial-video').pause();
  if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus();
}
function openTutorial() {
  if ($('#float-layer').hidden) previousFocus = document.activeElement;
  $('#float-layer').hidden = false;
  $('#tutorial-close').focus();
}
function dismissTutorial() {
  closeTutorial();
  if (['#connect', '#downloads', '#how-it-works'].includes(location.hash)) location.hash = client.authenticated ? 'customer' : 'welcome';
}
$('#tutorial-close').addEventListener('click', dismissTutorial);
$('#float-layer').addEventListener('click', (event) => {
  if (!event.target.closest('.float-stack')) dismissTutorial();
});
document.addEventListener('keydown', (event) => {
  if ($('#float-layer').hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); dismissTutorial(); }
  if (event.key === 'Tab') {
    const nodes = [...$('#float-layer').querySelectorAll('button, a[href], video[controls]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

function route() {
  let page = location.hash.slice(1) || 'welcome';
  if (page === 'how-it-works') page = 'connect';
  if (page === 'signin') page = 'login';
  if (['account', 'customers'].includes(page)) page = 'customer';
  if (['models', 'presets'].includes(page)) page = 'overview';
  const tutorial = ['connect', 'downloads'].includes(page);
  if (tutorial) page = client.authenticated ? 'customer' : 'welcome';
  if (['overview', 'customer', 'docs'].includes(page) && !client.authenticated) {
    pendingRoute = page;
    location.hash = 'login';
    return;
  }
  if (page === 'login' && client.authenticated) page = 'customer';
  if (!['overview', 'customer', 'docs', 'login'].includes(page)) page = 'welcome';
  $('#welcome').hidden = page !== 'welcome';
  $('#login-screen').hidden = page !== 'login';
  $('#app').hidden = !['overview', 'customer', 'docs'].includes(page);
  for (const screen of $$('[data-screen]')) screen.hidden = screen.dataset.screen !== page;
  for (const link of $$('[data-page]')) {
    const active = link.dataset.page === page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  if (tutorial) openTutorial(); else closeTutorial();
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = page === 'welcome' ? 'Gateway: a gateway for Claude Desktop' : `${({ overview: 'Overview', customer: 'Customer account', docs: 'Docs', login: 'Log in' })[page]} · Gateway`;
}
window.addEventListener('hashchange', route);
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href="#connect"], a[href="#downloads"], a[href="#how-it-works"]');
  if (link && location.hash === link.getAttribute('href')) { event.preventDefault(); route(); }
});

const digitPixels = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00010','01100'],
  ',':['00','00','00','00','11','01','10'],
  '-':['000','000','000','111','000','000','000'],
  '—':['000','000','000','111','000','000','000'],
};
function renderPixelBalance(value) {
  let x = 0, rects = '';
  for (const ch of value) {
    const glyph = digitPixels[ch];
    if (!glyph) continue;
    glyph.forEach((row, y) => [...row].forEach((pixel, i) => {
      if (pixel === '1') rects += `<rect x="${x+i}" y="${y}" width="1" height="1"/>`;
    }));
    x += glyph[0].length + 1;
  }
  const width = Math.max(1, x - 1), element = $('#balance-remaining');
  element.setAttribute('role', 'img'); element.setAttribute('aria-label', value);
  element.innerHTML = `<svg viewBox="0 0 ${width} 7" width="${width/7}em" height="1em" shape-rendering="crispEdges" aria-hidden="true" fill="currentColor">${rects}</svg>`;
}
function renderAccount(account = null) {
  $('#account-state').textContent = account ? account.inferenceEnabled ? 'Hosted messages enabled.' : 'Hosted messages unavailable.' : 'Signed out.';
  $('#inference-state').textContent = account ? account.inferenceEnabled ? 'Point Claude Desktop at the gateway to start using your credits.' : account.serviceStatus.message : '';
  renderPixelBalance(account ? BigInt(account.tokens.remaining).toLocaleString('en-US') : '—');
  for (const field of ['granted', 'used']) {
    $(`#balance-${field}`).textContent = account ? BigInt(account.tokens[field]).toLocaleString() : '—';
  }
  let share = 0;
  if (account) {
    const granted = BigInt(account.tokens.granted), remaining = BigInt(account.tokens.remaining);
    const hundredths = granted > 0n ? remaining * 10000n / granted : 0n;
    share = Number(hundredths < 0n ? 0n : hundredths > 10000n ? 10000n : hundredths) / 100;
  }
  $('#remaining-meter').setAttribute('width', String(share));
  $('#overview-progress').setAttribute('aria-valuenow', String(share));
  $('#balance-share').textContent = account ? `${share}% left` : '—';
  $('#balance-status').textContent = account ? 'Live balance from the account ledger. Updates every five seconds while this page is visible.' : 'Sign in to load your balance.';
  $('#customer-name').textContent = account?.customer.name || '—';
  $('#customer-id').textContent = account?.customer.id || '—';
  $('#customer-gateway').textContent = account ? gatewayOrigin : '—';
  $('#customer-key').textContent = account ? `•••• ${client.keySuffix}` : '—';
  $('#customer-inference').textContent = account ? account.inferenceEnabled ? 'Inference enabled' : account.serviceStatus.message : '';
  for (const field of ['remaining', 'granted', 'used', 'reserved', 'pending']) {
    $(`#customer-${field}`).textContent = account ? BigInt(account.tokens[field]).toLocaleString() : '—';
  }
  $('#customer-status').textContent = account ? 'Updated from your account. Reserved credits are held for requests in progress; pending usage is an estimate.' : 'Sign in to load your account.';
  $('#customer-refresh').disabled = !client.authenticated;
}

$('#toggle-api-key').addEventListener('click', () => {
  const show = $('#api-key').type === 'password';
  $('#api-key').type = show ? 'text' : 'password';
  $('#toggle-api-key').textContent = show ? 'Hide' : 'Show';
  $('#toggle-api-key').setAttribute('aria-pressed', String(show));
  $('#toggle-api-key').setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
});
function clearKeyInput() {
  $('#api-key').value = ''; $('#api-key').type = 'password';
  $('#toggle-api-key').textContent = 'Show';
  $('#toggle-api-key').setAttribute('aria-pressed', 'false');
  $('#toggle-api-key').setAttribute('aria-label', 'Show API key');
}
$('#api-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (signingIn) return;
  setError(''); signingIn = true;
  $('#login-submit').disabled = true;
  $('#login-submit').textContent = 'Checking account…';
  try {
    const account = await client.signIn($('#api-key').value);
    clearKeyInput(); renderAccount(account);
    const destination = pendingRoute; pendingRoute = 'customer';
    location.hash = destination; route();
    toast('Account connected');
  } catch (error) {
    if (error.code !== 'SESSION_CANCELLED') setError(error.name === 'TimeoutError' ? 'The account request timed out. Please try again.' : error.name === 'TypeError' ? 'Could not reach this gateway. Please try again.' : error.message);
  } finally {
    signingIn = false; $('#login-submit').disabled = false; $('#login-submit').textContent = 'Verify & log in';
  }
});
function signOut(message = '') {
  client.signOut(); pendingRoute = 'customer';
  clearKeyInput(); renderAccount(); closeTutorial();
  location.hash = 'login'; route(); setError(message);
  $('#api-key').focus();
}
$('#logout-btn').addEventListener('click', () => signOut());

async function refreshBalance() {
  if (!client.authenticated || refreshing || signingIn) return;
  refreshing = true;
  $('#customer-refresh').disabled = true;
  try {
    const account = await client.refresh();
    if (account) renderAccount(account);
  } catch (error) {
    if ([401, 403].includes(error.status)) signOut('Your key was revoked or is no longer valid. Please sign in again.');
    else {
      $('#balance-status').textContent = 'Refresh failed. The displayed balance may be out of date. Retrying shortly.';
      $('#customer-status').textContent = 'Refresh failed. The displayed balance may be out of date. Retrying shortly.';
    }
  } finally {
    refreshing = false;
    $('#customer-refresh').disabled = !client.authenticated;
  }
}
$('#customer-refresh').addEventListener('click', refreshBalance);
setInterval(() => { if (!document.hidden) refreshBalance(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBalance(); });
$('#copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(gatewayOrigin); toast('Gateway URL copied'); }
  catch {
    const range = document.createRange(); range.selectNodeContents($('#gateway-url'));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    toast('URL selected. Press Ctrl+C to copy.');
  }
});
renderAccount();
route();
