import express from 'express';
import TuyAPI from 'tuyapi';
import net from 'node:net';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLocalIr } from './irLocal.js';
import * as sound from './soundPlayer.js';
import * as spotify from './spotify.js';
import * as lendas from './lendas.js';
import { createScenes } from './scenes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5858;

// ════════════════════════════════════════════════════════════════════════════
//  Tuya (lâmpadas)
// ════════════════════════════════════════════════════════════════════════════

const configPath = join(__dirname, 'devices.json');
const devices = {};

if (!existsSync(configPath)) {
  console.warn('\n[lampadas] devices.json não encontrado — endpoints /api/lamps ficarão vazios.');
  console.warn('Copie devices.example.json para devices.json para habilitar.\n');
} else {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  for (const meta of config.devices) {
    setupDevice(meta);
  }
}

function setupDevice(meta) {
  const entry = { device: null, meta, effect: null, reconnecting: false, backoff: 2000, on: null };
  devices[meta.id] = entry;

  const device = new TuyAPI({
    id: meta.id,
    key: meta.key,
    ip: meta.ip,
    version: meta.version || '3.3',
    issueRefreshOnConnect: true
  });
  entry.device = device;

  const switchDp = meta.switchDp || 20;
  const updateOn = (dps) => {
    if (dps && Object.prototype.hasOwnProperty.call(dps, switchDp)) {
      entry.on = !!dps[switchDp];
    }
  };
  device.on('data', (data) => updateOn(data?.dps));
  device.on('dp-refresh', (data) => updateOn(data?.dps));

  const tryConnect = async () => {
    if (entry.reconnecting) return;
    entry.reconnecting = true;
    try {
      await device.find({ timeout: 5 });
      await device.connect();
      entry.backoff = 2000;
      console.log(`[${meta.name}] conectada`);
    } catch (err) {
      console.error(`[${meta.name}] falha ao conectar (${err.message}), retry em ${entry.backoff}ms`);
      setTimeout(() => { entry.reconnecting = false; tryConnect(); }, entry.backoff);
      entry.backoff = Math.min(entry.backoff * 2, 60000);
      return;
    } finally {
      entry.reconnecting = false;
    }
  };

  device.on('disconnected', () => {
    console.log(`[${meta.name}] desconectada, reconectando...`);
    setTimeout(tryConnect, 1000);
  });

  device.on('error', (err) => {
    console.error(`[${meta.name}] erro:`, err.message);
  });

  tryConnect();
}

function stopEffect(entry) {
  if (!entry.effect) return;
  if (entry.effect.handle) clearInterval(entry.effect.handle);
  if (entry.effect.stop) entry.effect.stop();
  entry.effect = null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const app = express();
app.use(express.json());

app.get('/api/lamps', (req, res) => {
  res.json(Object.values(devices).map(({ meta, device, effect, on }) => ({
    id: meta.id,
    name: meta.name,
    connected: device?.isConnected?.() || false,
    on,
    effect: effect?.type || null
  })));
});

app.get('/api/lamps/:id/state', async (req, res) => {
  const entry = devices[req.params.id];
  if (!entry?.device) return res.status(404).json({ error: 'lâmpada não conectada' });
  try {
    const dps = await entry.device.get({ schema: true });
    res.json(dps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Liga/desliga uma lâmpada — ao ligar volta pro branco no brilho mínimo.
// Usado pela rota /switch e pelas cenas (ver seção CENAS no fim do arquivo).
async function applyLampSwitch(entry, on) {
  if (!entry?.device) throw new Error('lâmpada não conectada');
  stopEffect(entry);
  const switchDp = entry.meta.switchDp || 20;
  const modeDp = entry.meta.modeDp || 21;
  const brightDp = entry.meta.brightnessDp || 22;
  const tempDp = entry.meta.tempDp || 23;
  if (on) {
    await entry.device.set({
      multiple: true,
      data: {
        [switchDp]: true,
        [modeDp]: 'white',
        [tempDp]: 0,
        [brightDp]: 1
      }
    });
  } else {
    await entry.device.set({ dps: switchDp, set: false });
  }
}

app.post('/api/lamps/:id/switch', async (req, res) => {
  const entry = devices[req.params.id];
  if (!entry?.device) return res.status(404).json({ error: 'lâmpada não conectada' });
  try {
    await applyLampSwitch(entry, !!req.body.on);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lamps/:id/blink', (req, res) => {
  const entry = devices[req.params.id];
  if (!entry?.device) return res.status(404).json({ error: 'lâmpada não conectada' });
  stopEffect(entry);
  const intervalMs = Math.max(100, Math.min(5000, Number(req.body.intervalMs) || 500));
  const durationMs = Math.max(0, Number(req.body.durationMs) || 0);
  const endOn = !!req.body.endOn;
  const dp = entry.meta.switchDp || 20;
  let state = false;
  const handle = setInterval(() => {
    state = !state;
    entry.device.set({ dps: dp, set: state }).catch(() => {});
  }, intervalMs);

  let endTimer = null;
  if (durationMs > 0) {
    endTimer = setTimeout(async () => {
      clearInterval(handle);
      entry.effect = null;
      // Retry the final state until success — same robustness as flicker.
      const deadline = Date.now() + 3000;
      let ok = false;
      while (Date.now() < deadline && !ok) {
        try {
          await entry.device.set({ dps: dp, set: endOn });
          ok = true;
        } catch {
          await sleep(150);
        }
      }
      if (ok) {
        await sleep(150);
        try { await entry.device.set({ dps: dp, set: endOn }); } catch {}
      } else {
        console.error(`[${entry.meta.name}] blink-end: falha ao confirmar ${endOn ? 'ON' : 'OFF'} após 3s`);
      }
    }, durationMs);
  }

  entry.effect = {
    type: 'blink',
    handle,
    stop: () => { if (endTimer) clearTimeout(endTimer); },
  };
  res.json({ ok: true, intervalMs, durationMs, endOn });
});

app.post('/api/lamps/:id/flicker', (req, res) => {
  const entry = devices[req.params.id];
  if (!entry?.device) return res.status(404).json({ error: 'lâmpada não conectada' });
  stopEffect(entry);
  const dp = entry.meta.switchDp || 20;
  const brightDp = entry.meta.brightnessDp || 22;
  // Tuya brightness range is 10..1000; we clamp the flicker to 1%..10% (10..100).
  const MIN_BRIGHT = 10;
  const MAX_BRIGHT = 100;
  let alive = true;

  const myEffect = { type: 'flicker', stop: () => { alive = false; } };
  entry.effect = myEffect;

  const loop = async () => {
    try {
      while (alive) {
        const burst = 3 + Math.floor(Math.random() * 6);
        for (let i = 0; i < burst && alive; i++) {
          const on = Math.random() > 0.3;
          const brightness = MIN_BRIGHT + Math.floor(Math.random() * (MAX_BRIGHT - MIN_BRIGHT + 1));
          try {
            await entry.device.set({ multiple: true, data: { [dp]: on, [brightDp]: brightness } });
          } catch {}
          await sleep(30 + Math.floor(Math.random() * 180));
        }
        if (alive) {
          try {
            await entry.device.set({ multiple: true, data: { [dp]: true, [brightDp]: MIN_BRIGHT } });
          } catch {}
          await sleep(1500 + Math.floor(Math.random() * 3500));
        }
      }
    } finally {
      // Guarantee final state: on, brightness 1%. Retry for up to 3s through
      // network glitches, then double-tap on success (some bulbs swallow the
      // first command). Abort if a new effect has replaced ours in the meantime.
      const finalData = { [dp]: true, [brightDp]: MIN_BRIGHT };
      const supplanted = () => entry.effect && entry.effect !== myEffect;
      const deadline = Date.now() + 3000;
      let ok = false;
      while (Date.now() < deadline && !ok) {
        if (supplanted()) return;
        try {
          await entry.device.set({ multiple: true, data: finalData });
          ok = true;
        } catch {
          await sleep(150);
        }
      }
      if (ok) {
        await sleep(150);
        if (supplanted()) return;
        try { await entry.device.set({ multiple: true, data: finalData }); } catch {}
      } else {
        console.error(`[${entry.meta.name}] flicker-end: falha ao confirmar 1% após 3s`);
      }
    }
  };

  loop();
  res.json({ ok: true });
});

const findByName = (name) => Object.values(devices).find(e => e.meta.name === name);

function runQuartoPiscar({ finalOn }) {
  const entrada = findByName('Quarto entrada');
  const saida = findByName('Quarto saida');
  if (!entrada?.device || !saida?.device) {
    throw new Error('Quarto entrada ou Quarto saida não conectada');
  }

  stopEffect(entrada);
  stopEffect(saida);

  const startBlink = (entry, intervalMs) => {
    const dp = entry.meta.switchDp || 20;
    let state = false;
    let alive = true;
    const loop = async () => {
      while (alive) {
        state = !state;
        try {
          await entry.device.set({ dps: dp, set: state });
        } catch {}
        if (!alive) return;
        await sleep(intervalMs);
      }
    };
    entry.effect = { type: 'blink', stop: () => { alive = false; } };
    loop();
  };

  startBlink(entrada, 100);
  startBlink(saida, 200);

  setTimeout(async () => {
    stopEffect(entrada);
    stopEffect(saida);
    await sleep(600);

    const applyFinal = async (entry) => {
      const switchDp = entry.meta.switchDp || 20;
      if (finalOn) {
        const modeDp = entry.meta.modeDp || 21;
        const brightDp = entry.meta.brightnessDp || 22;
        const tempDp = entry.meta.tempDp || 23;
        try {
          await entry.device.set({
            multiple: true,
            data: {
              [switchDp]: true,
              [modeDp]: 'white',
              [tempDp]: 0,
              [brightDp]: 1
            }
          });
        } catch (err) {
          console.error(`[${entry.meta.name}] erro ao aplicar branco:`, err.message);
        }
      } else {
        try {
          await entry.device.set({ dps: switchDp, set: false });
        } catch (err) {
          console.error(`[${entry.meta.name}] erro ao desligar:`, err.message);
        }
      }
    };

    const ensureFinalConfirmed = async (entry, attempts = 6) => {
      const switchDp = entry.meta.switchDp || 20;
      for (let i = 0; i < attempts; i++) {
        if (entry.on === finalOn) return true;
        try { await entry.device.set({ dps: switchDp, set: finalOn }); } catch {}
        const start = Date.now();
        while (Date.now() - start < 700) {
          if (entry.on === finalOn) return true;
          await sleep(80);
        }
      }
      console.error(`[${entry.meta.name}] não confirmou ${finalOn ? 'ON' : 'OFF'} após ${attempts} tentativas`);
      return false;
    };

    await Promise.all([applyFinal(entrada), applyFinal(saida)]);
    await sleep(300);
    await Promise.all([ensureFinalConfirmed(entrada), ensureFinalConfirmed(saida)]);
  }, 5000);
}

app.post('/api/automation/quarto-piscar', (req, res) => {
  try { runQuartoPiscar({ finalOn: true }); res.json({ ok: true, durationMs: 5000 }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/automation/quarto-piscar-desligar', (req, res) => {
  try { runQuartoPiscar({ finalOn: false }); res.json({ ok: true, durationMs: 5000 }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/lamps/:id/stop', (req, res) => {
  const entry = devices[req.params.id];
  if (!entry) return res.status(404).json({ error: 'lâmpada desconhecida' });
  stopEffect(entry);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  Smart IR LOCAL (sem nuvem) via tuyapi
// ════════════════════════════════════════════════════════════════════════════

const irLocalCfgPath = join(__dirname, 'ir-local.json');
const irLocalCodesPath = join(__dirname, 'ir-codes-local.json');

// Múltiplos Smart IR (blasters): ex. "porao" (fita de LED) e "quarto" (TV).
// Formato novo em ir-local.json: { "blasters": { "porao": {...}, "quarto": {...} } }.
// Formato antigo { id, key, ip, version } é migrado para o blaster "porao".
const DEFAULT_BLASTER = 'porao';
const irBlasters = {}; // { [id]: { device, busy, effect } }

function loadBlasterConfigs() {
  if (!existsSync(irLocalCfgPath)) {
    console.warn('[IR-local] ir-local.json não encontrado — controles IR desativados.');
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(irLocalCfgPath, 'utf-8'));
    return (raw.blasters && typeof raw.blasters === 'object') ? raw.blasters : { [DEFAULT_BLASTER]: raw };
  } catch (err) {
    console.error('[IR-local] ir-local.json inválido:', err.message);
    return {};
  }
}

// O DHCP troca os IPs dos blasters com frequência; quando a redescoberta acha
// o IP novo, salvamos de volta no ir-local.json para o próximo boot ser rápido.
function persistBlasterIp(name, newIp) {
  try {
    const raw = JSON.parse(readFileSync(irLocalCfgPath, 'utf-8'));
    if (raw.blasters?.[name]) {
      raw.blasters[name].ip = newIp;
      writeFileSync(irLocalCfgPath, JSON.stringify(raw, null, 2));
    }
    console.log(`[IR-local] blaster "${name}" mudou de IP → ${newIp} (salvo)`);
  } catch (e) {
    console.error(`[IR-local] falha ao salvar IP novo de "${name}":`, e.message);
  }
}

for (const [id, cfg] of Object.entries(loadBlasterConfigs())) {
  if (!cfg?.key || /COLE_AQUI/.test(cfg.key)) {
    console.warn(`[IR-local] blaster "${id}" sem local key — ignorado.`);
    continue;
  }
  const device = createLocalIr(cfg, { onIpFound: (newIp) => persistBlasterIp(id, newIp) });
  irBlasters[id] = { device, busy: false, effect: null };
  device.ensureConnected()
    .then(() => console.log(`[IR-local] blaster "${id}" conectado`))
    .catch((e) => console.warn(`[IR-local] blaster "${id}" ainda não conectado:`, e.message));
}

function loadLocalCodes() {
  if (!existsSync(irLocalCodesPath)) return { devices: {} };
  try {
    const d = JSON.parse(readFileSync(irLocalCodesPath, 'utf-8'));
    return { devices: d.devices || {} };
  } catch {
    return { devices: {} };
  }
}
function saveLocalCodes(store) {
  writeFileSync(irLocalCodesPath, JSON.stringify(store, null, 2));
}

// Resolve o blaster pedido (b.busy sinaliza aprendizado em curso, para o /status
// não reconectar no meio do study mode — o blaster só aceita 1 conexão TCP).
function getBlaster(res, id) {
  const b = irBlasters[id || DEFAULT_BLASTER];
  if (!b) {
    res.status(503).json({ error: `Smart IR "${id || DEFAULT_BLASTER}" não configurado em ir-local.json` });
    return null;
  }
  return b;
}

app.get('/api/ir-local/status', async (req, res) => {
  const id = String(req.query.blaster || DEFAULT_BLASTER);
  const b = irBlasters[id];
  const store = loadLocalCodes();
  const devices = Object.fromEntries(
    Object.entries(store.devices).map(([devId, d]) => [devId, { name: d.name, keys: Object.keys(d.keys || {}) }])
  );
  // O blaster derruba conexões ociosas; reconectamos sob demanda para reportar
  // o estado real (a menos que um aprendizado esteja rodando).
  let connected = false;
  if (b && !b.busy) {
    try { await b.device.ensureConnected(); connected = b.device.isConnected(); } catch { connected = false; }
  } else if (b) {
    connected = b.device.isConnected();
  }
  res.json({
    configured: !!b,
    connected,
    blaster: id,
    blasters: Object.keys(irBlasters),
    ip: b?.device?.state?.ip || null,
    devices,
    effect: b?.effect?.type || null,
    intervalMs: b?.effect?.intervalMs || null,
  });
});

// Força a reconexão/redescoberta agora (botão "Atualizar" da UI).
app.post('/api/ir-local/reconnect', async (req, res) => {
  const b = getBlaster(res, req.body.blaster);
  if (!b) return;
  if (b.busy) {
    return res.status(409).json({ error: 'blaster ocupado (gravando ou piscando) — pare antes de atualizar' });
  }
  b.busy = true; // segura o /status para não disputar a conexão durante a busca
  try {
    // Duas passadas: o blaster recém-voltado ao Wi-Fi recusa conexão por alguns
    // segundos; a 1ª passada descobre/salva o IP via broadcast e a 2ª conecta.
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await sleep(3000);
        await b.device.forceReconnect();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    res.json({ ok: true, connected: b.device.isConnected(), ip: b.device.state.ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    b.busy = false;
  }
});

app.post('/api/ir-local/learn', async (req, res) => {
  const b = getBlaster(res, req.body.blaster);
  if (!b) return;
  const device = String(req.body.device || 'fita-led');
  const deviceName = String(req.body.deviceName || device);
  const key = String(req.body.key || '').trim();
  if (!key) return res.status(400).json({ error: 'informe "key" (nome do botão)' });

  stopBlasterEffect(b);
  b.busy = true;
  try {
    await b.device.ensureConnected();
    const since = Date.now();
    await b.device.enterStudy();

    let code = null;
    let i = 0;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await sleep(800);
      if (b.device.state.lastCode && b.device.state.lastCodeAt >= since) {
        code = b.device.state.lastCode;
        break;
      }
      // O blaster derruba a conexão ociosa e sai do modo estudo; re-armamos a
      // cada ~5,6s (reconectando se preciso) para não perder a tecla.
      if (++i % 7 === 0) {
        try { await b.device.ensureConnected(); await b.device.enterStudy(); } catch { /* tenta de novo no próximo ciclo */ }
      }
    }
    await b.device.exitStudy().catch(() => {});

    if (!code) {
      return res.status(408).json({
        error: 'Nenhum código capturado em 30s. Aponte o controle para o Smart IR e pressione o botão durante o aprendizado.',
      });
    }

    const store = loadLocalCodes();
    store.devices[device] = store.devices[device] || { name: deviceName, keys: {} };
    store.devices[device].name = deviceName;
    store.devices[device].keys[key] = code;
    saveLocalCodes(store);
    res.json({ ok: true, device, key });
  } catch (err) {
    await b.device.exitStudy().catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    b.busy = false;
  }
});

// Dispara um código já aprendido. Erros carregam .status para a rota responder
// o mesmo que respondia antes (503 sem blaster, 404 sem código). Usado também
// pelas cenas, que precisam mandar IR sem passar por HTTP.
async function sendIrCode(blasterId, device, key) {
  const id = blasterId || DEFAULT_BLASTER;
  const b = irBlasters[id];
  if (!b) {
    throw Object.assign(new Error(`Smart IR "${id}" não configurado em ir-local.json`), { status: 503 });
  }
  const code = loadLocalCodes().devices[device]?.keys?.[key];
  if (!code) {
    throw Object.assign(new Error(`código "${key}" não aprendido para "${device}"`), { status: 404 });
  }
  stopBlasterEffect(b);
  await b.device.ensureConnected();
  await b.device.sendCode(code);
}

app.post('/api/ir-local/send', async (req, res) => {
  const device = String(req.body.device || 'fita-led');
  const key = String(req.body.key || '').trim();
  try {
    await sendIrCode(req.body.blaster, device, key);
    res.json({ ok: true, device, key });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/ir-local/codes/:device/:key', (req, res) => {
  const store = loadLocalCodes();
  const dev = store.devices[req.params.device];
  if (dev?.keys) delete dev.keys[req.params.key];
  saveLocalCodes(store);
  res.json({ ok: true });
});

// Pisca a fita alternando os códigos ON/OFF num intervalo configurável.
function stopBlasterEffect(b) {
  if (b?.effect?.handle) clearInterval(b.effect.handle);
  if (b) b.effect = null;
}

app.post('/api/ir-local/blink', (req, res) => {
  const b = getBlaster(res, req.body.blaster);
  if (!b) return;
  const device = String(req.body.device || 'fita-led');
  const intervalMs = Math.max(300, Math.min(10000, Number(req.body.intervalMs) || 800));
  const store = loadLocalCodes();
  const onCode = store.devices[device]?.keys?.on;
  const offCode = store.devices[device]?.keys?.off;
  if (!onCode || !offCode) {
    return res.status(404).json({ error: 'aprenda os botões "on" e "off" antes de piscar' });
  }

  const wasRunning = !!b.effect; // "Atualizar velocidade" (já piscando) x "Iniciar piscar"
  stopBlasterEffect(b);
  b.busy = true; // o efeito é dono da conexão; impede o /status de reconectar e brigar

  if (!wasRunning) sound.playAlert(); // som só ao iniciar o piscar, nas caixas configuradas

  let on = false;
  const tick = async () => {
    on = !on;
    try {
      await b.device.ensureConnected();
      await b.device.sendCode(on ? onCode : offCode);
    } catch { /* ignora glitch; próximo tick tenta de novo */ }
  };
  const handle = setInterval(tick, intervalMs);
  b.effect = { handle, type: 'blink', intervalMs };
  tick(); // primeiro disparo imediato
  res.json({ ok: true, intervalMs });
});

app.post('/api/ir-local/stop', (req, res) => {
  const b = irBlasters[req.body.blaster || DEFAULT_BLASTER];
  if (b) { stopBlasterEffect(b); b.busy = false; }
  sound.stopAlert(); // parar o piscar também para o som disparado ao iniciar
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  SOM na caixa (SoundCore 2) — ver soundPlayer.js
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/sound/list', (req, res) => {
  res.json({ sounds: sound.listSounds(), ...sound.status() });
});

app.post('/api/sound/play', (req, res) => {
  try {
    const { file, volume, loop } = req.body || {};
    res.json(sound.play({ file, volume, loop: !!loop }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sound/stop', (req, res) => {
  res.json(sound.stopAll()); // para a reprodução e também o som do "Iniciar piscar"
});

app.post('/api/sound/sound-volume', (req, res) => {
  try {
    res.json(sound.setSoundVolume(req.body?.file, req.body?.volume));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sound/volume', (req, res) => {
  try {
    res.json(sound.setVolume(req.body?.volume, req.body?.device));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/sound/devices', async (req, res) => {
  res.json({ devices: await sound.listDevices(), ...sound.status() });
});

app.post('/api/sound/outputs', (req, res) => {
  try {
    res.json(sound.setOutputs(req.body?.outputs));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  SIXLED (relógios ESP8266)
// ════════════════════════════════════════════════════════════════════════════
//
//  Os relógios SIXLED rodam num ESP8266 com firmware que tem dois quirks:
//   - Endpoints API (/dadoc, /cmd, /par) respondem 202 com Content-Length fixo
//     → fetch() padrão funciona
//   - Páginas HTML (/index, /valid, /salvacron) usam Transfer-Encoding: chunked
//     com formato inválido (HPE_INVALID_CHUNK_SIZE) → precisa TCP raw HTTP/1.0
//
//  Cada IP só aceita 1 conexão TCP simultânea, então serializamos por IP.

const SIXLED_DEFAULT_IPS = ['192.168.1.21', '192.168.1.7'];
const SIXLED_DEFAULT_NAMES = ['Relógio 1 porão', 'Relógio 2 quarto'];
const SIXLED_DEFAULT_PASSWORD = '123456';

function parseSixledDevices(req) {
  const raw = (req.query.ips || '').toString();
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const [ip1, ip2] = parts.length >= 2 ? parts : SIXLED_DEFAULT_IPS;
  return [
    { name: SIXLED_DEFAULT_NAMES[0], ip: ip1, password: SIXLED_DEFAULT_PASSWORD },
    { name: SIXLED_DEFAULT_NAMES[1], ip: ip2, password: SIXLED_DEFAULT_PASSWORD },
  ];
}

const sixledQueues = new Map();
const sixledCache = new Map(); // `${ip}${path}` → { ts, value, pending }
const SIXLED_CACHE_MS = 500;

function sixledEnqueue(ip, fn) {
  const prev = sixledQueues.get(ip) || Promise.resolve();
  const next = prev.then(fn, fn);
  sixledQueues.set(ip, next.catch(() => undefined));
  return next;
}

// Dedup concurrent calls for the same ip+path and cache the result briefly.
// Without this, polling clients (1Hz) flood the per-IP queue when a device
// times out (~6s), causing an ever-growing backlog.
function sixledCached(ip, path, fn) {
  const key = `${ip}${path}`;
  const now = Date.now();
  const entry = sixledCache.get(key);
  if (entry?.pending) return entry.pending;
  if (entry && now - entry.ts < SIXLED_CACHE_MS) return Promise.resolve(entry.value);

  const pending = fn().then(value => {
    sixledCache.set(key, { ts: Date.now(), value });
    return value;
  }, () => {
    sixledCache.set(key, { ts: Date.now(), value: null });
    return null;
  });
  sixledCache.set(key, { ts: entry?.ts ?? 0, value: entry?.value, pending });
  return pending;
}

async function sixledApiFetch(ip, path) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 2000);
  try {
    return await fetch(`http://${ip}${path}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function sixledTcpFetch(ip, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const method = opts.method || 'GET';
    const bodyStr = opts.body || '';
    const lines = [
      `${method} ${path} HTTP/1.0`,
      `Host: ${ip}`,
      ...Object.entries(opts.headers || {}).map(([k, v]) => `${k}: ${v}`),
      ...(bodyStr ? [`Content-Length: ${Buffer.byteLength(bodyStr, 'utf8')}`] : []),
      '', '',
    ];
    const buf = Buffer.from(lines.join('\r\n') + bodyStr, 'utf8');

    const socket = net.createConnection({ host: ip, port: 80 });
    const chunks = [];
    socket.setTimeout(3000);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('tcp timeout')); });
    socket.on('error', reject);
    socket.on('connect', () => socket.write(buf));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      const hdr = sep >= 0 ? raw.slice(0, sep) : '';
      const bdy = sep >= 0 ? raw.slice(sep + 4) : raw;
      const st = hdr.match(/HTTP\/1\.[01] (\d+)/);
      resolve({ status: st ? Number(st[1]) : 200, body: bdy });
    });
  });
}

async function sixledLogin(device) {
  await sixledTcpFetch(device.ip, '/valid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `senha=${encodeURIComponent(device.password)}`,
  });
}

function sixledApiGet(device, path) {
  return sixledCached(device.ip, path, () => sixledEnqueue(device.ip, async () => {
    try {
      let r = await sixledApiFetch(device.ip, path);
      if (r.status !== 202) {
        await sixledLogin(device);
        r = await sixledApiFetch(device.ip, path);
      }
      if (r.status !== 202) return null;
      return await r.json();
    } catch { return null; }
  }));
}

function sixledPageGet(device, path) {
  return sixledEnqueue(device.ip, async () => {
    try {
      let r = await sixledTcpFetch(device.ip, path);
      if (r.body.includes('nmpg="Login"')) {
        await sixledLogin(device);
        r = await sixledTcpFetch(device.ip, path);
      }
      return r.body;
    } catch (e) {
      console.error(`[SIXLED] pageGet ${device.ip}${path}:`, e.message);
      return null;
    }
  });
}

function sixledFormPost(device, path, body) {
  return sixledEnqueue(device.ip, async () => {
    try {
      const login = await sixledTcpFetch(device.ip, '/valid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `senha=${encodeURIComponent(device.password)}`,
      });
      console.log(`[sixled ${device.ip}] LOGIN status=${login.status} body=${login.body.slice(0, 200).replace(/\s+/g, ' ')}`);

      const r = await sixledTcpFetch(device.ip, path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Origin': `http://${device.ip}`,
          'Referer': `http://${device.ip}/index`,
          'Upgrade-Insecure-Requests': '1',
        },
        body,
      });
      console.log(`[sixled ${device.ip}] POST ${path} status=${r.status} body=${r.body.slice(0, 400).replace(/\s+/g, ' ')}`);
      console.log(`[sixled ${device.ip}] sent body: ${body}`);
      return r.status < 400;
    } catch (e) {
      console.log(`[sixled ${device.ip}] ERROR ${e.message}`);
      return false;
    }
  });
}

function parseSixledConfig(html) {
  function findElem(name) {
    const re = new RegExp(`<input[^>]*(?:\\bname=${name}\\b|\\bname="${name}")[^>]*>`, 'i');
    return html.match(re)?.[0] ?? '';
  }
  function getValue(elem) {
    return elem.match(/value="([^"]*)"/)?.[1]
      ?? elem.match(/\bvalue=([^\s>"]+)/)?.[1]
      ?? '';
  }
  function isChecked(name) {
    return /\bchecked\b/.test(findElem(name));
  }
  function checkedRadioValue(name) {
    const re = /<input[^>]*>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const el = m[0];
      if (new RegExp(`\\bname=${name}\\b`, 'i').test(el) && /\bchecked\b/.test(el)) {
        return el.match(/\bvalue="?(\d+)"?/)?.[1] ?? '1';
      }
    }
    return '1';
  }
  function getRangeValue(parNum) {
    const re = new RegExp(`<input[^>]*SPar\\(${parNum}[^>]*>`, 'i');
    const el = html.match(re)?.[0] ?? '';
    const v = el.match(/\bvalue="?(\d+)"?/)?.[1];
    return v ? Number(v) : undefined;
  }

  return {
    cre: checkedRadioValue('cre'),
    prep: getValue(findElem('prep')) || '3',
    so1: getValue(findElem('so1')) || '1',
    sof: getValue(findElem('sof')) || '2',
    tp1: getValue(findElem('tp1')) || '01:00:00',
    bpt: isChecked('bpt'),
    bp1: isChecked('bp1'),
    bi1: isChecked('bi1'),
    eh: isChecked('eh'),
    tph: getValue(findElem('tph')) || '5',
    ed: isChecked('ed'),
    tpd: getValue(findElem('tpd')) || '2',
    et: isChecked('et'),
    tpt: getValue(findElem('tpt')) || '2',
    brightness: getRangeValue(1),
    volume: getRangeValue(3),
  };
}

function buildSixledFormData(cfg) {
  const p = new URLSearchParams();
  p.set('cre', cfg.cre);
  p.set('prep', cfg.prep);
  p.set('so1', cfg.so1);
  p.set('sof', cfg.sof);
  p.set('tp1', cfg.tp1);
  if (cfg.bpt) p.set('bpt', 'on');
  if (cfg.bp1) p.set('bp1', 'on');
  if (cfg.bi1) p.set('bi1', 'on');
  p.set('sv', '&#128190; Salvar');
  if (cfg.eh) p.set('eh', 'on');
  p.set('tph', cfg.tph);
  if (cfg.ed) p.set('ed', 'on');
  p.set('tpd', cfg.tpd);
  if (cfg.et) p.set('et', 'on');
  p.set('tpt', cfg.tpt);
  return p.toString();
}

app.get('/api/sixled/status', async (req, res) => {
  const list = parseSixledDevices(req);
  const results = await Promise.all(list.map(async (d) => {
    const data = await sixledApiGet(d, '/dadoc');
    if (data) return { name: d.name, ip: d.ip, online: true, ...data };
    return { name: d.name, ip: d.ip, online: false, stc: -1 };
  }));
  res.json(results);
});

app.get('/api/sixled/cmd/:n', async (req, res) => {
  const list = parseSixledDevices(req);
  await Promise.all(list.map(d => sixledApiGet(d, `/cmd?n=${req.params.n}`)));
  res.json({ ok: true });
});

app.get('/api/sixled/par/:param/:value', async (req, res) => {
  const list = parseSixledDevices(req);
  await Promise.all(list.map(d => sixledApiGet(d, `/par?${req.params.param}=${req.params.value}`)));
  res.json({ ok: true });
});

app.get('/api/sixled/config', async (req, res) => {
  const list = parseSixledDevices(req);
  const html = await sixledPageGet(list[0], '/index');
  if (!html) return res.status(503).json({ error: 'Relógio 1 inacessível' });
  if (html.includes('nmpg="Login"')) {
    return res.status(401).json({ error: 'Autenticação falhou' });
  }
  res.json(parseSixledConfig(html));
});

app.post('/api/sixled/config', async (req, res) => {
  const list = parseSixledDevices(req);
  const form = buildSixledFormData(req.body);
  const results = await Promise.all(list.map(async d => ({
    ip: d.ip,
    ok: await sixledFormPost(d, '/salvacron', form),
  })));
  res.json({ ok: true, results });
});

// Replace tp1 on each clock (preserves everything else from the device's
// current config) and optionally stop+start so the new duration takes effect.
// Used when extending a running chronometer from the UI.
app.post('/api/sixled/extend', async (req, res) => {
  const list = parseSixledDevices(req);
  const tp1 = String(req.body?.tp1 || '').trim();
  const restart = req.body?.restart !== false;
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(tp1)) {
    return res.status(400).json({ error: 'tp1 inválido (use HH:MM:SS)' });
  }

  const results = await Promise.all(list.map(async (d) => {
    const html = await sixledPageGet(d, '/index');
    if (!html || html.includes('nmpg="Login"')) {
      return { ip: d.ip, ok: false, reason: 'config não acessível' };
    }
    const cfg = parseSixledConfig(html);
    cfg.tp1 = tp1;
    const saveOk = await sixledFormPost(d, '/salvacron', buildSixledFormData(cfg));
    if (saveOk && restart) {
      await sixledApiGet(d, '/cmd?n=3');
      await sixledApiGet(d, '/cmd?n=1');
    }
    return { ip: d.ip, ok: saveOk };
  }));
  res.json({ ok: true, results });
});

// ════════════════════════════════════════════════════════════════════════════
//  SPOTIFY (toca nas Alexas via Spotify Connect) — ver spotify.js
// ════════════════════════════════════════════════════════════════════════════

const spotifyRoute = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

app.get('/api/spotify/status', (req, res) => res.json(spotify.status()));

app.post('/api/spotify/config', spotifyRoute((req) => spotify.setConfig(req.body || {})));

// Abre no navegador (link normal, não fetch): manda o usuário pro login do Spotify.
app.get('/api/spotify/login', (req, res) => {
  try {
    res.redirect(spotify.authUrl());
  } catch (err) {
    res.status(400).send(`<p>${err.message}</p>`);
  }
});

// O Spotify redireciona pra cá com ?code=... — trocamos pelo refresh_token.
app.get('/api/spotify/callback', async (req, res) => {
  const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:system-ui;background:#12151c;color:#e6e9ee;padding:3rem;text-align:center">` +
    `<h1>${title}</h1><p>${body}</p></body>`;

  if (req.query.error) {
    return res.status(400).send(page('Login cancelado', String(req.query.error)));
  }
  try {
    await spotify.exchangeCode(String(req.query.code || ''));
    res.send(page('Spotify conectado ✅', 'Pode fechar esta aba e voltar pra aba Música.'));
  } catch (err) {
    res.status(400).send(page('Falhou ao conectar', err.message));
  }
});

app.post('/api/spotify/logout', (req, res) => res.json(spotify.logout()));

app.get('/api/spotify/devices', spotifyRoute(async () => ({ devices: await spotify.listDevices() })));

// Fixa o destino padrão (o grupo multi-cômodos das Alexas).
app.post('/api/spotify/device', spotifyRoute((req) => spotify.setDevice(req.body?.id, req.body?.name)));

app.post('/api/spotify/transfer', spotifyRoute((req) => spotify.transfer({ play: req.body?.play })));

app.get('/api/spotify/now', spotifyRoute(() => spotify.nowPlaying()));

app.get('/api/spotify/playlists', spotifyRoute(async () => ({ playlists: await spotify.playlists() })));

app.post('/api/spotify/command', spotifyRoute((req) => spotify.command(req.body?.action, req.body?.value)));

// ════════════════════════════════════════════════════════════════════════════
//  CENAS (um botão → música + luz + TV) — ver scenes.js
// ════════════════════════════════════════════════════════════════════════════

const scenes = createScenes({
  file: join(__dirname, 'scenes.json'),
  actions: {
    spotify: (action, value) => spotify.command(action, value),

    // match é regex no nome da lâmpada: "quarto" pega entrada E saída de uma vez.
    lamp: async ({ match, id, on }) => {
      const targets = id
        ? [devices[id]].filter(Boolean)
        : Object.values(devices).filter((e) => new RegExp(match, 'i').test(e.meta.name));
      if (!targets.length) throw new Error(`nenhuma lâmpada casa com "${id || match}"`);
      const results = await Promise.allSettled(targets.map((e) => applyLampSwitch(e, on)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) throw new Error(failed[0].reason?.message || 'falha ao acionar lâmpada');
    },

    ir: ({ blaster, device, key }) => sendIrCode(blaster, device, key),

    sound: (file) => { sound.play({ file }); },

    // Reusa as automações que já existem (o piscar do quarto). São
    // fire-and-forget: voltam na hora e terminam sozinhas em ~5s.
    automation: (name) => {
      const run = {
        'quarto-piscar': () => runQuartoPiscar({ finalOn: true }),
        'quarto-piscar-desligar': () => runQuartoPiscar({ finalOn: false }),
      }[name];
      if (!run) throw new Error(`automação desconhecida: ${name}`);
      run();
    },
  },
});

app.get('/api/scenes', (req, res) => res.json({ scenes: scenes.list() }));

// Um passo que falha não derruba a cena: o resultado diz o que deu certo.
app.post('/api/scenes/:id/run', async (req, res) => {
  try {
    res.json(await scenes.run(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.put('/api/scenes', (req, res) => {
  try {
    res.json({ scenes: scenes.save(req.body?.scenes) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  LENDAS (Finalizar jogo → salva o tempo da equipe no ranking) — ver lendas.js
// ════════════════════════════════════════════════════════════════════════════

const lendasRoute = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

app.get('/api/lendas/status', (req, res) => res.json({ configured: lendas.configured() }));

app.get('/api/lendas/teams', lendasRoute(async () => ({ teams: await lendas.listTeamsToday() })));

app.post('/api/lendas/ranking', lendasRoute((req) => lendas.saveRanking(req.body || {})));

// ════════════════════════════════════════════════════════════════════════════

const server = app.listen(PORT, () => {
  console.log(`API escutando em http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPorta ${PORT} já está em uso por outro processo.`);
    console.error(`Rode com outra porta: PORT=3040 npm run dev:api\n`);
  } else {
    console.error('Erro no servidor:', err);
  }
  process.exit(1);
});
