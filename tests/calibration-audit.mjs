import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const brl = text => Number(String(text).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const near = (actual, expected, tolerance = 0.02) => Math.abs(actual - expected) <= tolerance;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await page.goto(`${APP_URL}?calibrationAudit=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1200);

const snapshot = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    out[k] = localStorage.getItem(k);
  }
  return out;
});

try {
  await page.locator('[data-screen="screen-settings"]').click();
  await page.locator('#cfgWatts').fill('350');
  await page.locator('#cfgEnergyRate').fill('1');
  await page.locator('#cfgMachineCostHour').fill('3');
  await page.locator('#cfgFailureRate').fill('10');
  await page.locator('#btnSaveGlobalSettings').click();

  await page.locator('[data-screen="screen-filaments"]').click();
  await page.locator('#btnNewFilamentModal').click();
  const filamentName = `AUDIT-CAL-${Date.now()}`;
  await page.locator('#modalFilName').fill(filamentName);
  await page.locator('#modalFilType').selectOption('PLA');
  await page.locator('#modalFilColor').fill('Auditoria');
  await page.locator('#modalFilPrice').fill('150');
  await page.locator('#modalFilStock').fill('1000');
  await page.locator('#btnSaveFilModal').click();

  await page.locator('[data-screen="screen-calc"]').click();
  await page.locator('#calcHours').fill('5');
  await page.locator('#calcMins').fill('0');
  await page.locator('#calcGrams').fill('100');
  await page.locator('#calcMargin').fill('100');
  await page.locator('#calcExtraCosts').fill('0');
  await page.locator('#calcQty').fill('1');

  const options = await page.locator('#calcFilamentSelect option').allTextContents();
  const index = options.findIndex(x => x.includes(filamentName));
  assert(index >= 0, 'Filamento de auditoria não apareceu na calculadora');
  await page.locator('#calcFilamentSelect').selectOption({ index });
  await page.waitForTimeout(300);

  const filament = brl(await page.locator('#costFilamentVal').textContent());
  const energy = brl(await page.locator('#costEnergyVal').textContent());
  const machine = brl(await page.locator('#costMachineVal').textContent());
  const ops = brl(await page.locator('#costOpsVal').textContent());
  const total = brl(await page.locator('#costTotalVal').textContent());
  const energyLabel = await page.locator('#costEnergyVal').locator('xpath=..').textContent();

  assert(near(filament, 15.00), `Filamento: esperado R$ 15,00, veio R$ ${filament}`);
  assert(near(energy, 1.75), `Energia: esperado R$ 1,75, veio R$ ${energy}`);
  assert(near(machine, 15.00), `Máquina: esperado R$ 15,00, veio R$ ${machine}`);
  assert(near(ops, 3.18), `Falhas/perdas: esperado R$ 3,18, veio R$ ${ops}`);
  assert(near(total, 34.93), `Custo real: esperado R$ 34,93, veio R$ ${total}`);
  assert(String(energyLabel).includes('350W'), `Rótulo de energia não mostra 350W: ${energyLabel}`);

  console.log('PASS | Calibração Bambu usada integralmente na Calculadora');
  console.log(`Filamento=${filament.toFixed(2)} Energia=${energy.toFixed(2)} Máquina=${machine.toFixed(2)} Perdas=${ops.toFixed(2)} Total=${total.toFixed(2)}`);
} finally {
  await page.evaluate(saved => {
    localStorage.clear();
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
  }, snapshot);
  await browser.close();
}
