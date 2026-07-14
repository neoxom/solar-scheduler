// Solar Assistant - Inverter mode switcher
// Usage: node apply-settings.js [day|night]
// Connects to Solar Assistant via Puppeteer and applies the correct settings.

const puppeteer = require('puppeteer');

const SA_URL = process.env.SA_URL || 'https://neoxom.eu.solar-assistant.io/power';

const SETTINGS = {
  day: {
    output: 'Solar/Battery/Utility',   // SBU - solar first
    charger: 'Solar only',             // no grid charging
    maxCharge: '2',                    // 2A safety cap
  },
  night: {
    output: 'Utility/Solar/Battery',   // Utility first - grid available
    charger: 'Solar/Utility',          // solar preferred, grid as backup
    maxCharge: '20',                   // 20A - cheap tariff window
  },
};

async function applySettings(mode) {
  console.log(`[${new Date().toISOString()}] Applying ${mode.toUpperCase()} settings to Solar Assistant...`);
  const cfg = SETTINGS[mode];
  if (!cfg) throw new Error(`Unknown mode: ${mode}`);

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    // Suppress dialogs so LiveView alerts don't block
    page.on('dialog', async dialog => {
      console.log(`  Dialog: ${dialog.message()}`);
      await dialog.accept();
    });

    console.log('  Navigating to Power page...');
    await page.goto(SA_URL, { waitUntil: 'networkidle0' });

    // Debug: log the page URL and title to detect redirects (e.g. login page)
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`  Landed on: ${pageUrl} | Title: ${pageTitle}`);

    // Wait for Phoenix LiveView to mount the control selects
    console.log('  Waiting for select elements (Phoenix LiveView mount)...');
    await page.waitForSelector('select', { timeout: 30000 });

    // Apply settings via the Power management form
    const result = await page.evaluate((cfg) => {
      const sels = Array.from(document.querySelectorAll('select'));
      if (sels.length < 2) return `ERROR: only ${sels.length} select(s) found`;

      // Output source priority
      const outputSel = sels.find(s => Array.from(s.options).some(o => o.value === 'Solar/Battery/Utility' || o.value === 'Utility/Solar/Battery'));
      if (outputSel) {
        outputSel.value = cfg.output;
        outputSel.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        return 'ERROR: output select not found';
      }

      // Charger source priority
      const chargerSel = sels.find(s => Array.from(s.options).some(o => o.value === 'Solar only' || o.value === 'Solar/Utility'));
      if (chargerSel) {
        chargerSel.value = cfg.charger;
        chargerSel.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        return 'ERROR: charger select not found';
      }

      // Max grid charge current
      const chargeSel = sels.find(s => Array.from(s.options).some(o => o.value === '2' || o.value === '20'));
      if (chargeSel) {
        chargeSel.value = cfg.maxCharge;
        chargeSel.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Apply');
      if (!btn) return 'ERROR: Apply button not found';
      btn.click();
      return 'clicked';
    }, cfg);

    console.log(`  Apply result: ${result}`);

    if (result.startsWith('ERROR')) {
      throw new Error(result);
    }

    // Wait for RS232 command to complete (inverter takes 30-45s)
    console.log('  Waiting 45s for inverter to process command...');
    await new Promise(r => setTimeout(r, 45000));

    // Verify by reading current state
    const state = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('dt, .label, td')).map(el => el.textContent.trim());
      return rows.slice(0, 10).join(' | ');
    });
    console.log(`  Page state: ${state}`);
    console.log(`[${new Date().toISOString()}] Done. ${mode.toUpperCase()} mode applied successfully.`);

  } finally {
    await browser.close();
  }
}

// Determine mode from argument or from current Madrid time
let mode = process.argv[2];
if (!mode) {
  const madridHour = parseInt(
    new Date().toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' })
  );
  mode = (madridHour >= 1 && madridHour < 7) ? 'night' : 'day';
  console.log(`Auto-detected Madrid hour ${madridHour} → mode: ${mode}`);
}

applySettings(mode).catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
