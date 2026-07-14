// Solar Assistant - Inverter mode switcher
// Usage: node apply-settings.js [day|night]
const puppeteer = require('puppeteer');

const SA_URL = process.env.SA_URL || 'https://neoxom.eu.solar-assistant.io/power';

const SETTINGS = {
  day: {
    output: 'Solar/Battery/Utility',
    charger: 'Solar only',
    maxCharge: '2',
  },
  night: {
    output: 'Utility/Solar/Battery',
    charger: 'Solar/Utility',
    maxCharge: '20',
  },
};

async function applySettings(mode) {
  console.log(`[${new Date().toISOString()}] Applying ${mode.toUpperCase()} settings...`);
  const cfg = SETTINGS[mode];
  if (!cfg) throw new Error(`Unknown mode: ${mode}`);

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.on('dialog', async dialog => { await dialog.accept(); });

    await page.goto(SA_URL, { waitUntil: 'networkidle0' });

    const result = await page.evaluate((cfg) => {
      window.confirm = () => true;
      window.alert = () => {};
      const sels = Array.from(document.querySelectorAll('select'));
      if (sels.length < 2) return 'ERROR: selects not found';

      const outputSel = sels.find(s => Array.from(s.options).some(o => o.value === 'Solar/Battery/Utility' || o.value === 'Utility/Solar/Battery'));
      if (outputSel) { outputSel.value = cfg.output; outputSel.dispatchEvent(new Event('change', {bubbles:true})); }

      const chargerSel = sels.find(s => Array.from(s.options).some(o => o.value === 'Solar only' || o.value === 'Solar/Utility'));
      if (chargerSel) { chargerSel.value = cfg.charger; chargerSel.dispatchEvent(new Event('change', {bubbles:true})); }

      const chargeSel = sels.find(s => Array.from(s.options).some(o => o.value === '2' || o.value === '20'));
      if (chargeSel) { chargeSel.value = cfg.maxCharge; chargeSel.dispatchEvent(new Event('change', {bubbles:true})); }

      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Apply');
      if (!btn) return 'ERROR: Apply button not found';
      btn.click();
      return 'clicked';
    }, cfg);

    if (result.startsWith('ERROR')) throw new Error(result);
    console.log(`  Apply result: ${result}`);
    console.log('  Waiting 45s for inverter...');
    await new Promise(r => setTimeout(r, 45000));
    console.log(`[${new Date().toISOString()}] Done. ${mode.toUpperCase()} mode applied.`);
  } finally {
    await browser.close();
  }
}

let mode = process.argv[2];
if (!mode) {
  const h = parseInt(new Date().toLocaleString('en-US', {hour:'2-digit', hour12:false, timeZone:'Europe/Madrid'}));
  mode = (h >= 1 && h < 7) ? 'night' : 'day';
  console.log(`Auto-detected Madrid hour ${h} → ${mode}`);
}

applySettings(mode).catch(err => { console.error('FAILED:', err.message); process.exit(1); });
