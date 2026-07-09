// Varre a rede local procurando o Smart IR (e tenta conectar nele).
// Uso: npm run ir:scan
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { readFileSync } from 'fs';
import TuyAPI from 'tuyapi';

const BLASTER = (process.argv[2] || 'porao').trim();
const raw = JSON.parse(readFileSync(new URL('../ir-local.json', import.meta.url), 'utf-8'));
const cfg = raw.blasters ? raw.blasters[BLASTER] : raw;
if (!cfg?.id) {
  console.error(`Blaster "${BLASTER}" não encontrado em ir-local.json.`);
  process.exit(2);
}
const TARGET = cfg.id;
const udpKey = crypto.createHash('md5').update('yGAdlopoPVldABfn', 'utf8').digest();

function decode(msg) {
  for (const d of [msg.slice(20, msg.length - 8), msg.slice(24, msg.length - 8)]) {
    const t = d.toString('utf8');
    if (t.includes('gwId')) return t;
    try {
      const dec = crypto.createDecipheriv('aes-128-ecb', udpKey, null);
      const o = Buffer.concat([dec.update(d), dec.final()]).toString('utf8');
      if (o.includes('gwId')) return o;
    } catch { /* não é deste device */ }
  }
  return null;
}

console.log(`Procurando o Smart IR (${TARGET}) na rede por 20s...\n`);

const found = { ip: null };
const others = new Set();

for (const port of [6666, 6667]) {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  s.on('message', (msg, rinfo) => {
    const j = decode(msg);
    if (!j) return;
    const gw = (j.match(/"gwId":"([^"]+)"/) || [])[1];
    if (gw === TARGET && !found.ip) {
      found.ip = rinfo.address;
      console.log(`✅ Smart IR ENCONTRADO em ${rinfo.address} (porta ${port})`);
    } else if (gw && gw !== TARGET) {
      others.add(`${rinfo.address} (${gw})`);
    }
  });
  s.bind(port);
}

setTimeout(async () => {
  if (!found.ip) {
    console.log('❌ Smart IR NÃO apareceu na rede deste PC.');
    console.log('   Ele está em outra Wi-Fi/sub-rede ou num repetidor com isolamento de cliente.');
    if (others.size) console.log('\n   Outros dispositivos Tuya vistos:\n   - ' + [...others].join('\n   - '));
    process.exit(1);
  }
  // achou → tenta conectar localmente
  console.log('Tentando conexão local...');
  const d = new TuyAPI({ id: cfg.id, key: cfg.key, ip: found.ip, version: cfg.version || '3.3' });
  try {
    await d.connect();
    console.log(`✅ Conectado! O Plano B vai funcionar. (rode "npm run dev" e abra a aba Plano B)`);
    d.disconnect();
  } catch (e) {
    console.log('⚠️  Achou na rede mas não conectou:', e.message, '\n   (confira a local key em ir-local.json)');
  }
  setTimeout(() => process.exit(0), 500);
}, 20000);
