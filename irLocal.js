import TuyAPI from 'tuyapi';
import net from 'node:net';

// ────────────────────────────────────────────────────────────────────────────
//  Smart IR controlado LOCALMENTE (sem nuvem) via tuyapi.
//  Protocolo dos IR blasters Tuya:
//    DP 201 → comando/envio  |  DP 202 → código IR aprendido (leitura)
//    aprender: set 201 = {"control":"study"} → apertar o controle → ler 202
//    enviar:   set 201 = {"control":"send_ir","head":"","key1":"1"+código,...}
//  Requer a LOCAL KEY do dispositivo.
//
//  Descoberta de IP (DHCP embaralha os IPs com frequência) — cadeia de fallback:
//    1. IP configurado; 2. broadcast UDP (find); 3. varredura TCP da porta 6668
//    na sub-rede (para blasters que NÃO fazem broadcast, ex.: o do quarto).
//  Quando o IP muda, onIpFound(ip) é chamado para o chamador persistir.
//
//  IMPORTANTE: uma instância do TuyAPI fica INUTILIZÁVEL depois de um connect
//  que falhou (estado interno preso — reconectar nela dá "connection timed
//  out" para sempre). Por isso cada tentativa usa uma instância NOVA.
// ────────────────────────────────────────────────────────────────────────────

const DP_SEND = '201';
const DP_RECV = '202';

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label || 'operação'} excedeu ${ms}ms`)), ms)),
]);

// Testa se `host` aceita TCP na porta Tuya (6668). Rápido: 450ms.
function probeTuyaPort(host, ms = 450) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port: 6668 });
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok ? host : null); };
    s.setTimeout(ms);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

// Varre a sub-rede /24 atrás de dispositivos Tuya (porta 6668 aberta). ~2s.
async function scanSubnet(prefix) {
  const found = [];
  for (let start = 1; start <= 254; start += 64) {
    const batch = [];
    for (let i = start; i < start + 64 && i <= 254; i++) batch.push(probeTuyaPort(`${prefix}.${i}`));
    found.push(...(await Promise.all(batch)).filter(Boolean));
  }
  return found;
}

export function createLocalIr({ id, key, version = '3.3', ip }, { onIpFound } = {}) {
  const state = { lastCode: null, lastCodeAt: 0, ip: ip || null };
  let device = null;      // instância ativa (só existe quando conectada)
  let currentIp = ip || null;
  let connecting = null;  // dedup: vários chamadores aguardam a mesma tentativa

  const capture = (dps) => {
    const c = dps?.[DP_RECV];
    // Códigos reais têm ~190+ chars; fragmentos curtos são ruído de captura
    // (já vimos 12 chars serem reportados) — ignora e segue esperando.
    if (c && c.length >= 40) {
      state.lastCode = c;
      state.lastCodeAt = Date.now();
    }
  };

  // IR blaster não tem DPS de estado consultável: pedir status na conexão faz
  // o tuyapi estourar "Timeout waiting for status response". Desligamos as
  // consultas automáticas — o código aprendido (DP 202) chega via evento 'data'.
  function makeDevice(host) {
    const d = new TuyAPI({
      id,
      key,
      ip: host || undefined,
      version,
      issueGetOnConnect: false,
      issueRefreshOnConnect: false,
    });
    d.on('error', () => {}); // silencioso; erros aparecem no connect()
    d.on('data', (x) => capture(x?.dps));
    d.on('dp-refresh', (x) => capture(x?.dps));
    return d;
  }

  const adoptIp = (newIp) => {
    if (newIp && newIp !== currentIp) {
      currentIp = newIp;
      state.ip = newIp;
      onIpFound?.(newIp);
    }
  };

  // Tenta conectar num IP (ou via broadcast se host=null) com instância NOVA.
  // O handshake do 3.4/3.5 pode travar sem timeout — withTimeout + destroy.
  async function tryConnect(host, ms, findTimeout = 6) {
    const d = makeDevice(host);
    try {
      if (!host) await d.find({ timeout: findTimeout });
      await withTimeout(d.connect(), ms, 'connect');
      if (device && device !== d) { try { device.disconnect(); } catch {} }
      device = d;
      return;
    } catch (err) {
      try { d.disconnect(); } catch {}
      throw err;
    }
  }

  async function connectChain() {
    // A varredura TCP só serve no 3.4/3.5, onde o handshake valida id+key.
    // No 3.3 o connect NÃO valida nada: conectar num host errado "funciona" e
    // os comandos vão parar em outro aparelho (já adotamos uma lâmpada como
    // blaster assim). Para 3.3, só IP fixo e broadcast (que confere o id).
    const canScan = parseFloat(version) >= 3.4;
    // 1. IP conhecido (rápido)
    if (currentIp) {
      try { await tryConnect(currentIp, 4000); return; } catch {}
    }
    // 2. Broadcast UDP (confere o gwId; janela maior quando é o último recurso).
    //    O broadcast valida a identidade, então o IP achado é adotado/persistido
    //    MESMO se o connect falhar — o blaster recém-voltado ao Wi-Fi recusa
    //    conexões por alguns segundos, e a próxima tentativa já vai no IP certo.
    try {
      const d = makeDevice(null);
      await d.find({ timeout: canScan ? 6 : 15 });
      const foundIp = d.device.ip;
      adoptIp(foundIp);
      try {
        await withTimeout(d.connect(), 5000, 'connect');
        if (device && device !== d) { try { device.disconnect(); } catch {} }
        device = d;
        return;
      } catch {
        try { d.disconnect(); } catch {}
      }
      // connect falhou na instância do find (tuyapi a deixa presa) — instância nova
      try { await tryConnect(foundIp, 4000); return; } catch {}
    } catch {}
    // 3. Varredura TCP 6668 na sub-rede (blasters mudos — quarto).
    if (canScan) {
      const prefix = (currentIp || ip || '192.168.1.1').split('.').slice(0, 3).join('.');
      const candidates = await scanSubnet(prefix);
      for (const host of candidates) {
        if (host === currentIp) continue; // já falhou no passo 1
        try {
          await tryConnect(host, 4000);
          adoptIp(host);
          return;
        } catch {}
      }
    }
    throw new Error('blaster não encontrado (IP fixo, broadcast e varredura falharam)');
  }

  function ensureConnected() {
    if (device?.isConnected()) return Promise.resolve();
    if (!connecting) {
      connecting = connectChain().finally(() => { connecting = null; });
    }
    return connecting;
  }

  async function forceReconnect() {
    if (device) { try { device.disconnect(); } catch {} device = null; }
    await ensureConnected();
  }

  // Comandos IR não recebem eco de status; não esperamos resposta (senão timeout).
  const sendRaw = (obj) => {
    if (!device) return Promise.reject(new Error('blaster não conectado'));
    return device.set({ dps: DP_SEND, set: JSON.stringify(obj), shouldWaitForResponse: false });
  };

  return {
    state,
    isConnected: () => !!device?.isConnected(),
    ensureConnected,
    forceReconnect,
    enterStudy: () => sendRaw({ control: 'study' }),
    exitStudy: () => sendRaw({ control: 'study_exit' }),
    sendCode: (code) =>
      sendRaw({ control: 'send_ir', head: '', key1: '1' + code, type: 0, delay: 300 }),
  };
}
