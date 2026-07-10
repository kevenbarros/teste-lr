// Diagnóstico + extração de Local Keys direto da API da Tuya, sem o wizard.
//
// Uso:
//   node scripts/tuya-keys.js <ACCESS_ID> <ACCESS_SECRET> [DEVICE_ID]
//
// - ACCESS_ID / ACCESS_SECRET: aba Overview do projeto em iot.tuya.com
// - DEVICE_ID: opcional; se omitido usa o primeiro do devices.json
//
// Testa todos os data centers e mostra o código de erro REAL da Tuya
// (o wizard esconde tudo atrás de "There was an issue fetching that device").

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REGIONS = [
  { name: 'Western America (padrão p/ Brasil)', base: 'https://openapi.tuyaus.com' },
  { name: 'Eastern America', base: 'https://openapi-ueaz.tuyaus.com' },
  { name: 'Central Europe', base: 'https://openapi.tuyaeu.com' },
  { name: 'Western Europe', base: 'https://openapi-weaz.tuyaeu.com' },
  { name: 'India', base: 'https://openapi.tuyain.com' },
  { name: 'China', base: 'https://openapi.tuyacn.com' },
];

const ERROR_HINTS = {
  1004: 'Assinatura inválida → ACCESS_SECRET errado (ou o relógio do PC está muito fora da hora).',
  1005: 'Access ID não existe NESTE data center → ou o ACCESS_ID está errado, ou o projeto vive em outro data center (veja os outros resultados abaixo).',
  1010: 'Token expirado no meio da chamada — roda de novo.',
  1106: 'Sem permissão sobre esse device → a conta do app Smart Life NÃO está vinculada a este projeto neste data center (refaça o Link App Account via QR), ou o DEVICE_ID pertence a outra conta.',
  1100: 'Parâmetro vazio — confira os argumentos.',
  2007: 'Device não encontrado nesse data center — DEVICE_ID errado ou conta vinculada em outro data center.',
  2009: 'Access ID não existe NESTE data center → ou o ACCESS_ID está errado, ou o projeto vive em outro data center (veja os outros resultados).',
  28841002: 'Trial do IoT Core EXPIRADO → iot.tuya.com › Cloud › Cloud Services › IoT Core › Extend Trial.',
  28841101: 'O projeto não tem a API "IoT Core" autorizada → no projeto, aba Service API › Go to Authorize › adicione IoT Core.',
  28841105: 'Trial do IoT Core EXPIRADO → iot.tuya.com › Cloud › Cloud Services › IoT Core › Extend Trial.',
};

const EMPTY_BODY_SHA = createHash('sha256').update('').digest('hex');

function hmac(secret, msg) {
  return createHmac('sha256', secret).update(msg).digest('hex').toUpperCase();
}

async function tuyaGet(base, clientId, secret, path, accessToken) {
  const t = Date.now().toString();
  const stringToSign = ['GET', EMPTY_BODY_SHA, '', path].join('\n');
  const sign = hmac(secret, clientId + (accessToken || '') + t + stringToSign);
  const headers = {
    client_id: clientId,
    sign,
    t,
    sign_method: 'HMAC-SHA256',
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  const res = await fetch(base + path, { headers, signal: AbortSignal.timeout(10000) });
  return res.json();
}

function explain(code, msg) {
  const hint = ERROR_HINTS[code];
  return `erro ${code}: ${msg}${hint ? `\n     → ${hint}` : ''}`;
}

const [clientId, secret, deviceIdArg] = process.argv.slice(2);

if (!clientId || !secret) {
  console.log('Uso: node scripts/tuya-keys.js <ACCESS_ID> <ACCESS_SECRET> [DEVICE_ID]');
  console.log('Pegue Access ID/Secret na aba Overview do projeto em https://iot.tuya.com');
  process.exit(1);
}

let deviceId = deviceIdArg;
if (!deviceId) {
  const devicesPath = join(__dirname, '..', 'devices.json');
  if (existsSync(devicesPath)) {
    deviceId = JSON.parse(readFileSync(devicesPath, 'utf-8')).devices?.[0]?.id;
    console.log(`(sem DEVICE_ID no argumento — usando o primeiro do devices.json: ${deviceId})\n`);
  }
}
if (!deviceId) {
  console.error('Nenhum DEVICE_ID informado e devices.json não encontrado.');
  process.exit(1);
}

let success = false;

for (const region of REGIONS) {
  process.stdout.write(`\n■ ${region.name}\n`);

  let tokenResp;
  try {
    tokenResp = await tuyaGet(region.base, clientId, secret, '/v1.0/token?grant_type=1');
  } catch (err) {
    console.log(`   token: falha de rede (${err.message})`);
    continue;
  }
  if (!tokenResp.success) {
    console.log(`   token: ${explain(tokenResp.code, tokenResp.msg)}`);
    continue;
  }
  console.log('   token: OK ✔  (credenciais válidas neste data center)');
  const accessToken = tokenResp.result.access_token;

  const devResp = await tuyaGet(region.base, clientId, secret, `/v1.0/devices/${deviceId}`, accessToken);
  if (!devResp.success) {
    console.log(`   device: ${explain(devResp.code, devResp.msg)}`);
    continue;
  }

  const { name, local_key, uid, online, product_name } = devResp.result;
  console.log(`   device: OK ✔  "${name}" (${product_name}) — online: ${online}`);

  const listResp = await tuyaGet(region.base, clientId, secret, `/v1.0/users/${uid}/devices`, accessToken);
  const list = listResp.success ? listResp.result : [{ name, id: deviceId, local_key }];

  console.log('\n   ══ Dispositivos da conta (copie id + key p/ devices.json) ══');
  for (const d of list) {
    console.log(`   • ${d.name}`);
    console.log(`       id:  ${d.id}`);
    console.log(`       key: ${d.local_key}`);
  }
  success = true;
  break;
}

if (!success) {
  console.log('\nNenhum data center funcionou. Olhe os erros acima:');
  console.log(' - "token: erro" em TODOS → problema de credencial/assinatura ou trial expirado');
  console.log(' - "token: OK" mas "device: erro 1106/2007" → refaça o Link App Account (QR) no projeto');
}
