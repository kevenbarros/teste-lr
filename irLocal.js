import TuyAPI from 'tuyapi';

// ────────────────────────────────────────────────────────────────────────────
//  Plano B — Smart IR controlado LOCALMENTE (sem nuvem) via tuyapi.
//  Protocolo dos IR blasters Tuya:
//    DP 201 → comando/envio  |  DP 202 → código IR aprendido (leitura)
//    aprender: set 201 = {"control":"study"} → apertar o controle → ler 202
//    enviar:   set 201 = {"control":"send_ir","head":"","key1":"1"+código,...}
//  Requer a LOCAL KEY do dispositivo (o IP é descoberto na rede).
// ────────────────────────────────────────────────────────────────────────────

const DP_SEND = '201';
const DP_RECV = '202';

export function createLocalIr({ id, key, version = '3.3', ip }) {
  // IR blaster não tem DPS de estado consultável: pedir status na conexão faz
  // o tuyapi estourar "Timeout waiting for status response". Desligamos as
  // consultas automáticas — o código aprendido (DP 202) chega via evento 'data'.
  const device = new TuyAPI({
    id,
    key,
    ip: ip || undefined,
    version,
    issueGetOnConnect: false,
    issueRefreshOnConnect: false,
  });
  const state = { connected: false, lastCode: null, lastCodeAt: 0 };

  device.on('connected', () => { state.connected = true; });
  device.on('disconnected', () => { state.connected = false; });
  device.on('error', () => {}); // silencioso; erros aparecem no connect()

  const capture = (dps) => {
    const c = dps?.[DP_RECV];
    // Códigos reais têm ~190+ chars; fragmentos curtos são ruído de captura
    // (já vimos 12 chars serem reportados) — ignora e segue esperando.
    if (c && c.length >= 40) {
      state.lastCode = c;
      state.lastCodeAt = Date.now();
    }
  };
  device.on('data', (d) => capture(d?.dps));
  device.on('dp-refresh', (d) => capture(d?.dps));

  async function ensureConnected() {
    if (device.isConnected()) return;
    try {
      if (!ip) await device.find({ timeout: 7 });
      await device.connect();
    } catch (err) {
      // O IP fixo pode ter mudado (DHCP). O find() do tuyapi NÃO sobrescreve um
      // ip já definido, então limpamos antes para forçar a redescoberta por
      // broadcast. (Só funciona se o blaster fizer broadcast; senão, mantém o
      // erro original.)
      try {
        device.device.ip = undefined;
        await device.find({ timeout: 7 });
        await device.connect();
      } catch {
        throw err;
      }
    }
  }

  // Comandos IR não recebem eco de status; não esperamos resposta (senão timeout).
  const sendRaw = (obj) =>
    device.set({ dps: DP_SEND, set: JSON.stringify(obj), shouldWaitForResponse: false });

  return {
    state,
    isConnected: () => device.isConnected(),
    ensureConnected,
    enterStudy: () => sendRaw({ control: 'study' }),
    exitStudy: () => sendRaw({ control: 'study_exit' }),
    sendCode: (code) =>
      sendRaw({ control: 'send_ir', head: '', key1: '1' + code, type: 0, delay: 300 }),
  };
}
