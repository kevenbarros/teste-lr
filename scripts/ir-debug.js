// Diagnóstico do modo aprendizado IR: conecta, entra em study e loga TUDO que
// o blaster envia por 35s. Rode e aperte o botão do controle da fita apontando
// para o blaster. Uso: npm run ir:debug
import { readFileSync } from 'fs';
import TuyAPI from 'tuyapi';

const cfg = JSON.parse(readFileSync(new URL('../ir-local.json', import.meta.url), 'utf-8'));
console.log(`Device ${cfg.id} @ ${cfg.ip || '(broadcast)'} v${cfg.version || '3.3'}\n`);

const device = new TuyAPI({
  id: cfg.id,
  key: cfg.key,
  ip: cfg.ip || undefined,
  version: cfg.version || '3.3',
  issueGetOnConnect: false,
  issueRefreshOnConnect: false,
});

const ts = () => new Date().toISOString().slice(11, 23);
device.on('data', (d) => console.log(`[${ts()}] DATA       :`, JSON.stringify(d)));
device.on('dp-refresh', (d) => console.log(`[${ts()}] DP-REFRESH :`, JSON.stringify(d)));
device.on('error', (e) => console.log(`[${ts()}] ERROR      :`, e.message));
device.on('disconnected', () => console.log(`[${ts()}] DISCONNECTED`));
device.on('connected', () => console.log(`[${ts()}] CONNECTED`));

const send = (label, obj) =>
  device.set({ dps: 201, set: JSON.stringify(obj), shouldWaitForResponse: false })
    .then(() => console.log(`[${ts()}] enviado ${label}: ${JSON.stringify(obj)}`))
    .catch((e) => console.log(`[${ts()}] falha ${label}:`, e.message));

(async () => {
  try {
    if (!cfg.ip) await device.find({ timeout: 7 });
    await device.connect();
  } catch (e) {
    console.log('Falha ao conectar:', e.message);
    process.exit(1);
  }

  // Tenta os comandos de study mais comuns; se um deles for o certo, o código
  // aprendido vai aparecer como DATA/DP-REFRESH quando você apertar o botão.
  await send('study (control)', { control: 'study' });
  await new Promise((r) => setTimeout(r, 400));

  console.log('\n>>>>> APONTE O CONTROLE DA FITA PARA O BLASTER E APERTE UM BOTÃO AGORA <<<<<');
  console.log('>>>>> (você tem 35s — pode apertar várias vezes) <<<<<\n');

  // mantém vivo e re-arma study a cada 8s caso o aparelho saia do modo
  let n = 0;
  const keep = setInterval(async () => {
    n++;
    if (!device.isConnected()) {
      console.log(`[${ts()}] reconectando...`);
      try { await device.connect(); } catch {}
    }
    await device.set({ dps: 201, set: JSON.stringify({ control: 'study' }), shouldWaitForResponse: false }).catch(() => {});
  }, 8000);

  setTimeout(async () => {
    clearInterval(keep);
    await device.set({ dps: 201, set: JSON.stringify({ control: 'study_exit' }), shouldWaitForResponse: false }).catch(() => {});
    console.log('\nFim do diagnóstico. Copie TODAS as linhas acima.');
    process.exit(0);
  }, 35000);
})();
