// Solar Assistant - Inverter mode switcher
// Required env var: SA_TOKEN (Solar Assistant API token)
// Usage: node apply-settings.js [day|night]

const puppeteer = require('puppeteer');

const SA_TOKEN = process.env.SA_TOKEN;
const SITE_ID  = 3056; // neoxom

if (!SA_TOKEN) { console.error('ERROR: SA_TOKEN required'); process.exit(1); }

const MODES = {
  day:   { output: 'Solar/Battery/Utility', charger: 'Solar only',  maxCharge: '2'  },
  night: { output: 'Utility first',         charger: 'Solar first', maxCharge: '20' },
};

function getMode() {
  const arg = process.argv[2];
  if (arg === 'day' || arg === 'night') return arg;
  const h = parseInt(new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }));
  const mode = (h >= 1 && h < 7) ? 'night' : 'day';
  console.log('Auto-detected Madrid hour ' + h + ' -> mode: ' + mode);
  return mode;
}

async function getCallbackUrl() {
  console.log('Getting SA cloud auth URL...');
  const res = await fetch('https://solar-assistant.io/api/v1/sites/' + SITE_ID + '/authorize', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SA_TOKEN },
  });
  if (!res.ok) throw new Error('Authorize failed: HTTP ' + res.status + ' ' + await res.text());
  const data = await res.json();
  const callbackUrl = 'https://' + data.site_host + '/callback?token=' + data.token;
  console.log('Site: ' + data.site_host);
  return { callbackUrl, siteHost: data.site_host };
}

async function applySettings(mode) {
  const cfg = MODES[mode];
  const { callbackUrl, siteHost } = await getCallbackUrl();
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.evaluateOnNewDocument(() => { window.alert = () => {}; });
    page.on('dialog', async d => { await d.dismiss(); });

    console.log('Authenticating...');
    await page.goto(callbackUrl, { waitUntil: 'networkidle0' });
    console.log('  Landed on:', page.url());

    await page.goto('https://' + siteHost + '/power', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[phx-click="edit"]', { timeout: 30000 });

    await page.evaluate(() => {
      const link = document.querySelector('[phx-click="edit"][phx-target="2"]');
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    const result = await page.evaluate((cfg) => {
      window.alert = () => {};
      const sels = Array.from(document.querySelectorAll('select'));
      if (sels.length < 2) return { error: 'Selects not found' };
      const chargerSel   = sels.find(s => Array.from(s.options).some(o => o.value === 'Solar only'));
      const maxChargeSel = sels.find(s => Array.from(s.options).some(o => o.value === '10'));
      const outputSel    = sels.find(s => s !== chargerSel && s !== maxChargeSel && s.options.length <= 4);
      if (outputSel)    { outputSel.value = cfg.output;    outputSel.dispatchEvent(new Event('change', {bubbles:true})); }
      if (chargerSel)   { chargerSel.value = cfg.charger;  chargerSel.dispatchEvent(new Event('change', {bubbles:true})); }
      if (maxChargeSel) { maxChargeSel.value = cfg.maxCharge; maxChargeSel.dispatchEvent(new Event('change', {bubbles:true})); }
      return {
        output:    outputSel    ? outputSel.value    : 'NOT FOUND',
        charger:   chargerSel   ? chargerSel.value   : 'NOT FOUND',
        maxCharge: maxChargeSel ? maxChargeSel.value : 'NOT FOUND',
      };
    }, cfg);

    if (result.error) throw new Error(result.error);
    console.log('  Values set:', JSON.stringify(result));

    await new Promise(r => setTimeout(r, 1000));
    const clicked = await page.evaluate(() => {
      window.alert = () => {};
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Apply');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('Apply button not found');
    console.log('  Apply clicked. Waiting 45s for inverter...');
    await new Promise(r => setTimeout(r, 45000));
    console.log('[' + new Date().toISOString() + '] Done. ' + mode.toUpperCase() + ' mode applied.');
  } finally {
    await browser.close();
  }
}

applySettings(getMode()).catch(err => { console.error('FAILED:', err.message); process.exit(1); });
