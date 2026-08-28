import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'https://calculadora.tavernado3d.workers.dev/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const results = [];
const consoleErrors = [];
const pageErrors = [];

page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => pageErrors.push(String(err)));

const ok = (name, details = '') => results.push({ name, ok: true, details });
const fail = (name, err) => results.push({ name, ok: false, details: err?.message || String(err) });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const brl = (text) => Number(String(text).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

async function test(name, fn) {
  try { await fn(); ok(name); } catch (e) { fail(name, e); }
}

async function nav(screen) {
  await page.locator(`[data-screen="${screen}"]`).click();
  await page.waitForTimeout(150);
  assert(await page.locator(`#${screen}`).evaluate(el => el.classList.contains('active')), `Tela ${screen} não ficou ativa`);
}

await page.goto(`${APP_URL}?audit=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

const snapshot = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); out[k] = localStorage.getItem(k);
  }
  return out;
});

await test('Navegação entre todas as abas', async () => {
  for (const s of ['screen-calc','screen-bambu','screen-orders','screen-quotes','screen-filaments','screen-settings']) await nav(s);
});

await test('Campos principais estão editáveis', async () => {
  const ids = ['calcItemName','calcHours','calcMins','calcGrams','calcMargin','calcExtraCosts','calcQty','quoteClientName','quoteClientPhone','quoteDeadline','quoteShipping','quoteNotes','cfgWatts','cfgEnergyRate','cfgMachineCostHour','cfgFailureRate'];
  for (const id of ids) {
    const loc = page.locator(`#${id}`);
    assert(await loc.count(), `Campo #${id} não existe`);
    assert(!(await loc.isDisabled()), `Campo #${id} está desabilitado`);
  }
});

await test('Aba Taverna salva e recarrega configurações', async () => {
  await nav('screen-settings');
  await page.locator('#cfgWatts').fill('211');
  await page.locator('#cfgEnergyRate').fill('1.37');
  await page.locator('#cfgMachineCostHour').fill('3.21');
  await page.locator('#cfgFailureRate').fill('7');
  await page.locator('#btnSaveGlobalSettings').click();
  await page.waitForTimeout(300);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('taverna3d:config') || '{}'));
  assert(cfg.watts === 211, 'Watts não salvou');
  assert(cfg.energyRate === 1.37, 'Tarifa não salvou');
  assert(cfg.machineCostHour === 3.21, 'Custo/hora não salvou');
  assert(cfg.failureRate === 7, 'Taxa de falha não salvou');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await nav('screen-settings');
  assert(await page.locator('#cfgWatts').inputValue() === '211', 'Watts não persistiu após reload');
  assert(await page.locator('#cfgEnergyRate').inputValue() === '1.37', 'Tarifa não persistiu após reload');
});

const filamentName = `AUDIT-PLA-${Date.now()}`;
await test('Cadastro de filamento salva no estoque', async () => {
  await nav('screen-filaments');
  await page.locator('#btnNewFilamentModal').click();
  await page.locator('#modalFilName').fill(filamentName);
  await page.locator('#modalFilType').selectOption('PLA');
  await page.locator('#modalFilColor').fill('Teste Preto');
  await page.locator('#modalFilPrice').fill('125');
  await page.locator('#modalFilStock').fill('850');
  await page.locator('#btnSaveFilModal').click();
  const fil = await page.evaluate(name => (JSON.parse(localStorage.getItem('taverna3d:filaments') || '[]')).find(f => f.name === name), filamentName);
  assert(fil, 'Filamento não foi salvo no localStorage');
  assert(Number(fil.priceKg) === 125, 'Preço/kg incorreto');
  assert(Number(fil.stockG) === 850, 'Estoque incorreto');
});

await test('Calculadora recalcula custos e preços', async () => {
  await nav('screen-calc');
  await page.locator('#calcItemName').fill('Peça Auditoria');
  await page.locator('#calcHours').fill('1');
  await page.locator('#calcMins').fill('30');
  await page.locator('#calcGrams').fill('100');
  await page.locator('#calcMargin').fill('50');
  await page.locator('#calcExtraCosts').fill('2');
  await page.locator('#calcQty').fill('1');
  const opts = await page.locator('#calcFilamentSelect option').allTextContents();
  const idx = opts.findIndex(x => x.includes(filamentName));
  assert(idx >= 0, 'Filamento recém cadastrado não apareceu na calculadora');
  await page.locator('#calcFilamentSelect').selectOption({ index: idx });
  await page.waitForTimeout(250);
  const costFil = brl(await page.locator('#costFilamentVal').textContent());
  const costEnergy = brl(await page.locator('#costEnergyVal').textContent());
  const costMachine = brl(await page.locator('#costMachineVal').textContent());
  const total = brl(await page.locator('#costTotalVal').textContent());
  const direct = brl(await page.locator('#priceDirect').textContent());
  const shopee = brl(await page.locator('#priceShopee').textContent());
  assert(Math.abs(costFil - 12.5) < 0.05, `Custo de filamento esperado ~12,50, veio ${costFil}`);
  assert(costEnergy > 0, 'Custo de energia não calculou');
  assert(costMachine > 0, 'Custo da máquina não calculou');
  assert(total > 0 && direct > total, 'Preço direto não foi calculado acima do custo');
  assert(shopee > direct, 'Preço Shopee não incorporou taxas');
});

await test('Orçamento recebe dados e gera mensagem', async () => {
  await nav('screen-calc');
  await page.locator('#btnQuickQuote').click();
  await page.waitForTimeout(200);
  assert(await page.locator('#screen-quotes').evaluate(el => el.classList.contains('active')), 'Atalho não abriu Orçamentos');
  await page.locator('#quoteClientName').fill('Cliente Auditoria');
  await page.locator('#quoteClientPhone').fill('11987654321');
  await page.locator('#quoteDeadline').fill('5 dias');
  await page.locator('#quoteShipping').fill('15');
  await page.locator('#quoteNotes').fill('Teste automático');
  await page.waitForTimeout(150);
  const preview = await page.locator('#quotePreviewText').inputValue();
  assert(preview.includes('Cliente Auditoria'), 'Nome do cliente não entrou na mensagem');
  assert(preview.includes('Peça Auditoria'), 'Peça da calculadora não entrou no orçamento');
});

await test('Envio para WhatsApp monta URL correta', async () => {
  await page.evaluate(() => { window.__auditOpenedUrl = ''; window.open = (u) => { window.__auditOpenedUrl = String(u); return null; }; });
  await page.locator('#btnSendWhatsApp').click();
  const url = await page.evaluate(() => window.__auditOpenedUrl);
  assert(url.includes('web.whatsapp.com/send'), `URL inesperada: ${url}`);
  assert(url.includes('5511987654321'), `Telefone não foi normalizado com +55: ${url}`);
  assert(url.includes('text='), 'Mensagem não foi anexada ao WhatsApp');
});

await test('Copiar texto do orçamento funciona', async () => {
  await page.locator('#btnCopyQuoteText').click();
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes('Cliente Auditoria'), 'Clipboard não recebeu o orçamento');
});

await test('Converter orçamento em pedido salva', async () => {
  const before = await page.evaluate(() => (JSON.parse(localStorage.getItem('taverna3d:orders') || '[]')).length);
  await page.locator('#btnQuoteToOrder').click();
  await page.waitForTimeout(200);
  const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('taverna3d:orders') || '[]'));
  assert(orders.length === before + 1, 'Pedido não foi criado a partir do orçamento');
  assert(orders.some(o => String(o.client).includes('Cliente Auditoria')), 'Cliente do orçamento não chegou ao pedido');
});

await test('Novo pedido manual salva corretamente', async () => {
  await nav('screen-orders');
  await page.locator('#btnNewOrderModal').click();
  await page.locator('#modalOrderClient').fill('Cliente Manual Audit');
  await page.locator('#modalOrderProduct').fill('Produto Manual Audit');
  await page.locator('#modalOrderChannel').selectOption('whatsapp');
  await page.locator('#modalOrderPrice').fill('99.90');
  await page.locator('#btnSaveOrderModal').click();
  const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('taverna3d:orders') || '[]'));
  const found = orders.find(o => o.client === 'Cliente Manual Audit');
  assert(found, 'Pedido manual não foi persistido');
  assert(Math.abs(Number(found.price) - 99.9) < 0.01, 'Preço do pedido manual não persistiu');
});

await test('Bambu: componentes essenciais da telemetria existem', async () => {
  await nav('screen-bambu');
  for (const id of ['bambuStatusBadge','bambuStatusText','bambuNozzleTemp','bambuBedTemp','bambuFanSpeed','bambuSpeedMode','btnSyncBambuHeader']) {
    assert(await page.locator(`#${id}`).count(), `Componente Bambu #${id} ausente`);
  }
});

await test('Bambu -> Calculadora: integração automática existe', async () => {
  const refs = await page.evaluate(() => {
    const src = Array.from(document.scripts).map(s => s.textContent || '').join('\n');
    const itemWrites = /calcItemName[^\n]{0,120}(appBambu|fileName)|(appBambu|fileName)[^\n]{0,120}calcItemName/.test(src);
    const timeWrites = /calcHours[^\n]{0,120}appBambu|appBambu[^\n]{0,120}calcHours/.test(src);
    return { itemWrites, timeWrites };
  });
  assert(refs.itemWrites || refs.timeWrites, 'Não há rotina automática que leve os dados atuais da Bambu para os campos da Calculadora');
});

await test('Service Worker não mantém código antigo por cache-first', async () => {
  const sw = await page.evaluate(async () => (await fetch('/service-worker.js', { cache: 'no-store' })).text());
  assert(sw.includes('networkFirst'), 'Service Worker não usa network-first para código do app');
  assert(sw.includes("u.pathname.startsWith('/api/')"), 'Service Worker não exclui APIs do cache');
});

// Restaura completamente o armazenamento usado pelo navegador de auditoria.
await page.evaluate(saved => {
  localStorage.clear();
  for (const [k,v] of Object.entries(saved)) localStorage.setItem(k, v);
}, snapshot);

console.log('\n=== TAVERNA DO 3D — AUDITORIA E2E ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.details ? ` | ${r.details}` : ''}`);
if (consoleErrors.length) console.log('\nConsole errors:', consoleErrors.slice(0, 20));
if (pageErrors.length) console.log('\nPage errors:', pageErrors.slice(0, 20));

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\nResumo: ${results.length - failed.length}/${results.length} testes aprovados.`);
if (failed.length) process.exit(1);
