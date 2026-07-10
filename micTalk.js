// ────────────────────────────────────────────────────────────────────────────
//  micTalk — "drop in" caseiro: transmite o microfone do PC AO VIVO para as
//  caixas escolhidas (endpoints WASAPI — ex.: Echo/Alexa pareada por Bluetooth).
//
//  Mesmo padrão do soundPlayer: cada transmissão é UM processo PowerShell
//  (scripts/talk-ctl.ps1 + tools/NAudio.dll) com um WasapiOut por caixa;
//  parar = matar o processo. As caixas do interfone são independentes das
//  caixas de sons e persistem em talk-config.json (gitignored):
//    { outputs:[{name,volume}], mic: "" }   // mic vazio = padrão do Windows
//
//  API:
//    status()            → { talking, live, elapsedMs, outputs, mic, error }
//    listMics()          → Promise<string[]> microfones ativos
//    start() / stop()    → abre/fecha o canal de voz
//    setOutputs(list)    → caixas que recebem a voz (persiste; reinicia se aberto)
//    setMic(name)        → microfone usado ('' = padrão; persiste; reinicia se aberto)
//    setVolume(v, name?) → volume da caixa ao vivo (reusa sound-ctl -Action volume)
//
//  Vigia da saída padrão: quando a Alexa conecta por Bluetooth, o Windows a
//  torna a saída PADRÃO do PC — e todo o som do sistema passaria a sair nela.
//  Um watcher (talk-ctl -Action watch) avisa quando o padrão muda; se o novo
//  padrão for uma caixa do interfone, devolvemos o padrão à caixa anterior via
//  tools/SoundVolumeView.exe. As caixas do interfone continuam recebendo a voz
//  e os sons do sistema normalmente (esses vão direto ao endpoint, sem padrão).
// ────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DLL = join(__dirname, 'tools', 'NAudio.dll');
const TALK_PS1 = join(__dirname, 'scripts', 'talk-ctl.ps1');
const SOUND_PS1 = join(__dirname, 'scripts', 'sound-ctl.ps1'); // -Action volume é genérico
const SVV = join(__dirname, 'tools', 'SoundVolumeView.exe');   // muda a saída padrão do Windows
const CONFIG_PATH = join(__dirname, 'talk-config.json');

const clampVol = (v) => Math.max(0, Math.min(100, Math.round(Number(v)) || 0));

function normOutputs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => ({ name: String(o?.name || '').trim(), volume: clampVol(o?.volume ?? 40) }))
    .filter((o) => o.name && !o.name.includes('|')); // "|" é o separador no ps1
}

let outputs = [];
let mic = '';
try {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  outputs = normOutputs(cfg.outputs);
  mic = String(cfg.mic || '').trim();
} catch { /* sem config ainda: usuário escolhe as caixas na aba Configuração */ }

function saveConfig() {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ outputs, mic }, null, 2) + '\n');
  } catch (err) {
    console.warn('[falar] não consegui salvar talk-config.json:', err.message);
  }
}

let session = null;   // transmissão ativa { child, live, startedAt }
let lastError = null; // motivo da última queda (mostrado na UI)

function available() {
  return process.platform === 'win32' && existsSync(DLL) && existsSync(TALK_PS1);
}

function spawnPs(ps1, args, opts = {}) {
  // -ParentPid só existe no talk-ctl (sound-ctl não aceita o parâmetro)
  const parent = ps1 === TALK_PS1 ? ['-ParentPid', String(process.pid)] : [];
  return spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Dll', DLL, ...parent, ...args],
    { windowsHide: true, stdio: 'ignore', ...opts },
  );
}

const EXIT_ERRORS = {
  4: 'nenhuma das caixas escolhidas está disponível — a Alexa está conectada ao PC por Bluetooth?',
  5: 'nenhum microfone encontrado no PC',
  6: 'a captação parou sozinha (microfone desconectado?)',
};

export function status() {
  return {
    talking: !!session,
    live: session?.live || false,
    elapsedMs: session?.live ? Date.now() - session.startedAt : 0,
    outputs: outputs.map((o) => ({ ...o })),
    mic,
    error: lastError,
  };
}

// Microfones ativos do Windows (FriendlyName dos endpoints Capture).
export function listMics() {
  return new Promise((resolve) => {
    if (!available()) return resolve([]);
    let out = '';
    const child = spawnPs(TALK_PS1, ['-Action', 'mics'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
    child.on('error', () => resolve([]));
    setTimeout(() => { try { child.kill(); } catch { /* já saiu */ } }, 8000);
  });
}

export function start() {
  if (!available()) throw new Error('interfone indisponível (requer Windows + tools/NAudio.dll)');
  if (!outputs.length) throw new Error('escolha as caixas que recebem a voz na aba Configuração');

  stop();
  lastError = null;

  const args = [
    '-Action', 'talk',
    '-Devices', outputs.map((o) => o.name).join('|'),
    '-Volumes', outputs.map((o) => o.volume).join('|'),
    '-LatencyMs', '150',
  ];
  if (mic) args.push('-Mic', mic);

  const child = spawnPs(TALK_PS1, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const entry = { child, live: false, startedAt: 0 };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    if (!entry.live && d.includes('STARTED')) { entry.live = true; entry.startedAt = Date.now(); }
  });
  child.on('exit', (code) => {
    if (session !== entry) return;
    session = null;
    if (!child.killed) lastError = EXIT_ERRORS[code] || `a transmissão caiu (código ${code})`;
  });
  child.on('error', (err) => {
    if (session !== entry) return;
    session = null;
    lastError = `falha ao iniciar a captação: ${err.message}`;
  });

  session = entry;
  return status();
}

export function stop() {
  if (session?.child) { try { session.child.kill(); } catch { /* já morreu */ } }
  session = null;
  return status();
}

// Caixas que recebem a voz (persiste). Se estiver ao vivo, reinicia na hora.
export function setOutputs(list) {
  const next = normOutputs(list);
  if (!next.length) throw new Error('selecione pelo menos uma caixa');
  const changed =
    next.map((o) => `${o.name}:${o.volume}`).join('|') !== outputs.map((o) => `${o.name}:${o.volume}`).join('|');
  outputs = next;
  saveConfig();
  if (changed && session) start();
  // a caixa recém-marcada pode JÁ ser a saída padrão (Windows a escolheu ao conectar)
  if (currentDefault && isTalkOutput(currentDefault.name)) restoreDefault();
  return status();
}

// Microfone usado ('' = padrão de comunicação do Windows). Reinicia se ao vivo.
export function setMic(name) {
  mic = String(name || '').trim();
  saveConfig();
  if (session) start();
  return status();
}

// Volume da CAIXA ao vivo (endpoint), sem interromper a transmissão.
export function setVolume(vol, deviceName) {
  const v = clampVol(vol);
  const name = String(deviceName || '').trim();
  let changed;
  if (name) {
    if (!outputs.some((o) => o.name === name)) throw new Error(`caixa "${name}" não está nas saídas do interfone`);
    outputs = outputs.map((o) => (o.name === name ? { ...o, volume: v } : o));
    changed = [{ name, volume: v }];
  } else {
    outputs = outputs.map((o) => ({ ...o, volume: v }));
    changed = outputs;
  }
  saveConfig();
  if (available() && existsSync(SOUND_PS1)) {
    try {
      spawnPs(SOUND_PS1, [
        '-Devices', changed.map((o) => o.name).join('|'),
        '-Volumes', changed.map((o) => o.volume).join('|'),
        '-Action', 'volume',
      ]).on('error', () => {});
    } catch { /* ignora */ }
  }
  return status();
}

// ────────────────────────────────────────────────────────────────────────────
//  Vigia da saída padrão do Windows (ver comentário no topo do arquivo)
// ────────────────────────────────────────────────────────────────────────────

let watcher = null;        // processo talk-ctl -Action watch
let currentDefault = null; // saída padrão atual do Windows { id, name }
let pcDefault = null;      // última saída padrão que NÃO é caixa do interfone

// A caixa é do interfone? (nome exato como listado, ou trecho — regra do ps1)
function isTalkOutput(name) {
  return outputs.some((o) => name === o.name || name.includes(o.name));
}

// Saídas ativas com ID de endpoint: [{ id, name }] (para o fallback do restore).
function listOuts() {
  return new Promise((resolve) => {
    let out = '';
    const child = spawnPs(TALK_PS1, ['-Action', 'outs'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => resolve(out.split(/\r?\n/).map((line) => {
      const i = line.indexOf('|');
      return i > 0 ? { id: line.slice(0, i).trim(), name: line.slice(i + 1).trim() } : null;
    }).filter((d) => d?.id && d?.name)));
    child.on('error', () => resolve([]));
    setTimeout(() => { try { child.kill(); } catch { /* já saiu */ } }, 8000);
  });
}

// Devolve a saída padrão do Windows para uma caixa que não é do interfone:
// a última padrão conhecida ou, sem ela, a primeira saída ativa fora da lista.
async function restoreDefault() {
  if (!existsSync(SVV)) return;
  let target = pcDefault && !isTalkOutput(pcDefault.name) ? pcDefault : null;
  if (!target) target = (await listOuts()).find((d) => !isTalkOutput(d.name)) || null;
  if (!target) return; // só existem caixas do interfone: deixa como está
  try {
    spawn(SVV, ['/SetDefault', target.id, 'all'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    console.log(`[falar] saída padrão do PC devolvida para "${target.name}"`);
  } catch { /* ignora */ }
}

function startWatcher() {
  if (!available() || watcher) return;
  const child = spawnPs(TALK_PS1, ['-Action', 'watch'], { stdio: ['ignore', 'pipe', 'ignore'] });
  watcher = child;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('DEFAULT|')) continue;
      const rest = line.slice('DEFAULT|'.length);
      const sep = rest.indexOf('|');
      if (sep <= 0) continue;
      currentDefault = { id: rest.slice(0, sep).trim(), name: rest.slice(sep + 1).trim() };
      if (isTalkOutput(currentDefault.name)) restoreDefault();
      else pcDefault = currentDefault;
    }
  });
  child.on('exit', () => { watcher = null; setTimeout(startWatcher, 5000).unref(); });
  child.on('error', () => { watcher = null; });
}

startWatcher();
