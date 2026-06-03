import express from 'express';
import TuyAPI from 'tuyapi';
import net from 'node:net';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

app.post('/api/lamps/:id/switch', async (req, res) => {
  const entry = devices[req.params.id];
  if (!entry?.device) return res.status(404).json({ error: 'lâmpada não conectada' });
  stopEffect(entry);
  const switchDp = entry.meta.switchDp || 20;
  const modeDp = entry.meta.modeDp || 21;
  const brightDp = entry.meta.brightnessDp || 22;
  const tempDp = entry.meta.tempDp || 23;
  try {
    if (req.body.on) {
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
      try { await entry.device.set({ dps: dp, set: false }); } catch {}
    }, durationMs);
  }

  entry.effect = {
    type: 'blink',
    handle,
    stop: () => { if (endTimer) clearTimeout(endTimer); },
  };
  res.json({ ok: true, intervalMs, durationMs });
});

app.post('/api/lamps/:id/flicker', (req, res) => {
  const entry = devices[req.params.id];
  if (!entry?.device) return res.status(404).json({ error: 'lâmpada não conectada' });
  stopEffect(entry);
  const dp = entry.meta.switchDp || 20;
  const brightDp = entry.meta.brightnessDp || 22;
  let alive = true;

  const loop = async () => {
    while (alive) {
      const burst = 3 + Math.floor(Math.random() * 6);
      for (let i = 0; i < burst && alive; i++) {
        const on = Math.random() > 0.3;
        const brightness = 10 + Math.floor(Math.random() * 990);
        try {
          await entry.device.set({ multiple: true, data: { [dp]: on, [brightDp]: brightness } });
        } catch {}
        await sleep(30 + Math.floor(Math.random() * 180));
      }
      if (alive) {
        try {
          await entry.device.set({ multiple: true, data: { [dp]: true, [brightDp]: 1000 } });
        } catch {}
        await sleep(1500 + Math.floor(Math.random() * 3500));
      }
    }
  };

  entry.effect = { type: 'flicker', stop: () => { alive = false; } };
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
      await sixledLogin(device);
      const r = await sixledTcpFetch(device.ip, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      return r.status < 400;
    } catch { return false; }
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
  p.set('sv', 'Salvar');
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
