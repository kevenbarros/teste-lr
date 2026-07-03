// Aprende UM botão IR (modo dedicado e robusto) e salva em ir-codes-local.json.
// Uso:  node scripts/ir-learn.js <key>     (ex: on, off)
//   ou: npm run ir:learn:on  /  npm run ir:learn:off
//
// IMPORTANTE: pare o `npm run dev` antes (o blaster só aceita 1 conexão).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import TuyAPI from 'tuyapi';

const KEY = (process.argv[2] || '').trim();
const DEVICE = 'fita-led';
const DEVICE_NAME = 'Fita de LED porão';
const WINDOW_MS = 40000;

if (!KEY) {
  console.error('Informe a tecla. Ex: node scripts/ir-learn.js on');
  process.exit(2);
}

const cfgUrl = new URL('../ir-local.json', import.meta.url);
const codesUrl = new URL('../ir-codes-local.json', import.meta.url);
const cfg = JSON.parse(readFileSync(cfgUrl, 'utf-8'));

const device = new TuyAPI({
  id: cfg.id,
  key: cfg.key,
  ip: cfg.ip || undefined,
  version: cfg.version || '3.3',
  issueGetOnConnect: false,
  issueRefreshOnConnect: false,
});

let captured = null;
const grab = (d) => {
  const c = d?.dps?.['202'];
  if (c && !captured) captured = c;
};
device.on('data', grab);
device.on('dp-refresh', grab);
device.on('error', () => {});

const study = () =>
  device.set({ dps: 201, set: JSON.stringify({ control: 'study' }), shouldWaitForResponse: false }).catch(() => {});
const studyExit = () =>
  device.set({ dps: 201, set: JSON.stringify({ control: 'study_exit' }), shouldWaitForResponse: false }).catch(() => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Conectando em ${cfg.ip || '(broadcast)'}...`);
  try {
    if (!cfg.ip) await device.find({ timeout: 7 });
    await device.connect();
  } catch (e) {
    console.error('Falha ao conectar:', e.message, '\n→ O `npm run dev` está parado? O IP está certo? (npm run ir:scan ou arp -a)');
    process.exit(1);
  }

  await study();
  console.log(`\n>>> APRENDENDO "${KEY.toUpperCase()}" <<<`);
  console.log('>>> Aponte o controle da fita para o blaster e APERTE o botão (pode repetir). 40s...\n');

  const deadline = Date.now() + WINDOW_MS;
  let i = 0;
  while (Date.now() < deadline && !captured) {
    await sleep(800);
    if (++i % 6 === 0) {
      if (!device.isConnected()) { try { await device.connect(); } catch {} }
      await study(); // re-arma o modo estudo (o blaster sai dele sozinho)
    }
  }
  await studyExit();

  if (!captured) {
    console.error('\n❌ Nenhum código capturado. Aproxime/aponte melhor o controle e tente de novo.');
    process.exit(1);
  }

  const store = existsSync(codesUrl)
    ? JSON.parse(readFileSync(codesUrl, 'utf-8'))
    : { devices: {} };
  store.devices = store.devices || {};
  store.devices[DEVICE] = store.devices[DEVICE] || { name: DEVICE_NAME, keys: {} };
  store.devices[DEVICE].name = DEVICE_NAME;
  store.devices[DEVICE].keys[KEY] = captured;
  writeFileSync(codesUrl, JSON.stringify(store, null, 2));

  console.log(`\n✅ Botão "${KEY.toUpperCase()}" aprendido e salvo!`);
  console.log(`   (${captured.length} chars)`);
  console.log('   Teclas salvas:', Object.keys(store.devices[DEVICE].keys).join(', '));
  process.exit(0);
})();
