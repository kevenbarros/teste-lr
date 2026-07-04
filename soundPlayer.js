// ────────────────────────────────────────────────────────────────────────────
//  soundPlayer — toca sons SOMENTE nas caixas configuradas (1..N ao mesmo tempo).
//
//  Reproduz qualquer arquivo de sounds/ (wav/mp3) direto nos endpoints WASAPI
//  dos dispositivos escolhidos, sem trocar o dispositivo padrão: o fone continua
//  tocando e as caixas não espelham o áudio do sistema — só o que este módulo manda.
//
//  API:
//    listSounds()                       → nomes de arquivos disponíveis
//    listDevices()                      → Promise<string[]> saídas de áudio ativas
//    play({ file, volume, loop })       → toca em TODAS as caixas configuradas
//                                         (volume, se passado, aplica em todas)
//    stop()                             → para a reprodução atual (todas as caixas)
//    setVolume(v, deviceName?)          → volume AO VIVO; com deviceName ajusta só
//                                         aquela caixa, sem ele ajusta todas
//    setOutputs([{ name, volume }])     → define as caixas de saída (persiste)
//    status()                           → { playing, file, loop, outputs }
//    playOneShot(file)                  → som avulso em todas as caixas (não
//                                         interrompe o play(); usado pelo piscar)
//    playAlert()                        → som do "Iniciar piscar" (alertSound)
//
//  Config persistida em sound-config.json (gitignored):
//    { "outputs": [{ "name": "...", "volume": 40 }, ...], "alertSound": "trovao.mp3" }
//  Migra o formato antigo { device, volume }. Fallbacks: env ALERT_DEVICE /
//  ALERT_VOLUME / ALERT_SOUND, depois "SoundCore 2" / 40 / trovao.mp3.
//  "name" pode ser o nome EXATO do endpoint (vindo do seletor da página Sons)
//  ou um trecho (ex.: "SoundCore 2").
//
//  Implementação: cada reprodução é UM processo PowerShell (scripts/sound-ctl.ps1
//  + tools/NAudio.dll) que abre um WasapiOut por caixa. "Parar" = matar o processo.
// ────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DLL = join(__dirname, 'tools', 'NAudio.dll');
const PS1 = join(__dirname, 'scripts', 'sound-ctl.ps1');
const SOUNDS_DIR = join(__dirname, 'sounds');
const CONFIG_PATH = join(__dirname, 'sound-config.json');

const EXTS = new Set(['.wav', '.mp3']);
const clampVol = (v) => Math.max(0, Math.min(100, Math.round(Number(v)) || 0));

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

function normOutputs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => ({ name: String(o?.name || '').trim(), volume: clampVol(o?.volume ?? 40) }))
    .filter((o) => o.name && !o.name.includes('|')); // "|" é o separador no ps1
}

const cfg = loadConfig();
let outputs = normOutputs(cfg.outputs);
if (!outputs.length) {
  // migra config antiga { device, volume } / env / padrão
  outputs = [{
    name: cfg.device || process.env.ALERT_DEVICE || 'SoundCore 2',
    volume: clampVol(cfg.volume ?? process.env.ALERT_VOLUME ?? 40),
  }];
}
let alertSound = cfg.alertSound || process.env.ALERT_SOUND || 'trovao.mp3';

function saveConfig() {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ outputs, alertSound }, null, 2) + '\n');
  } catch (err) {
    console.warn('[som] não consegui salvar sound-config.json:', err.message);
  }
}

let current = null; // { child, file, loop }

function available() {
  return process.platform === 'win32' && existsSync(DLL) && existsSync(PS1);
}

// Resolve um nome de som para caminho seguro dentro de sounds/ (sem path traversal).
function resolveSound(file) {
  const name = basename(String(file || ''));
  if (!EXTS.has(extname(name).toLowerCase())) return null;
  const p = join(SOUNDS_DIR, name);
  return existsSync(p) ? p : null;
}

// Spawn do ps1 mirando um conjunto de caixas (padrão: todas as configuradas).
function spawnCtl(extraArgs, outs = outputs, opts = {}) {
  return spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1,
      '-Dll', DLL,
      '-Devices', outs.map((o) => o.name).join('|'),
      '-Volumes', outs.map((o) => o.volume).join('|'),
      ...extraArgs],
    { windowsHide: true, stdio: 'ignore', ...opts },
  );
}

export function listSounds() {
  try {
    return readdirSync(SOUNDS_DIR)
      .filter((f) => EXTS.has(extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// Saídas de áudio ativas do Windows (FriendlyName dos endpoints Render).
export function listDevices() {
  return new Promise((resolve) => {
    if (!available()) return resolve([]);
    let out = '';
    const child = spawnCtl(['-Action', 'list'], outputs, { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
    child.on('error', () => resolve([]));
    setTimeout(() => { try { child.kill(); } catch { /* já saiu */ } }, 8000);
  });
}

export function status() {
  return {
    playing: !!current,
    file: current?.file || null,
    loop: current?.loop || false,
    outputs: outputs.map((o) => ({ ...o })),
  };
}

export function stop() {
  if (current?.child) { try { current.child.kill(); } catch { /* já morreu */ } }
  current = null;
  return status();
}

export function play({ file, volume: vol, loop = false } = {}) {
  if (!available()) throw new Error('reprodução de som indisponível (requer Windows + tools/NAudio.dll)');
  const wav = resolveSound(file);
  if (!wav) throw new Error(`som "${file}" não encontrado em sounds/`);
  if (vol != null) { // volume avulso no play aplica em todas as caixas
    outputs = outputs.map((o) => ({ ...o, volume: clampVol(vol) }));
    saveConfig();
  }

  stop(); // uma reprodução controlável por vez

  const args = ['-Action', 'play', '-Wav', wav];
  if (loop) args.push('-Loop');
  const child = spawnCtl(args);
  const entry = { child, file: basename(wav), loop: !!loop };
  current = entry;
  child.on('exit', () => { if (current === entry) current = null; });
  child.on('error', (err) => { if (current === entry) current = null; console.warn('[som] falhou:', err.message); });
  return status();
}

// Volume ao vivo (não interrompe a reprodução). Com deviceName, só aquela caixa.
export function setVolume(vol, deviceName) {
  const v = clampVol(vol);
  const name = String(deviceName || '').trim();
  let changed;
  if (name) {
    changed = outputs.filter((o) => o.name === name);
    if (!changed.length) throw new Error(`caixa "${name}" não está nas saídas configuradas`);
    outputs = outputs.map((o) => (o.name === name ? { ...o, volume: v } : o));
    changed = [{ name, volume: v }];
  } else {
    outputs = outputs.map((o) => ({ ...o, volume: v }));
    changed = outputs;
  }
  saveConfig();
  if (available()) {
    try { spawnCtl(['-Action', 'volume'], changed).on('error', () => {}); } catch { /* ignora */ }
  }
  return status();
}

// Define as caixas de saída (persiste). Se a lista de caixas mudou e algo estava
// tocando, reinicia o mesmo som nas caixas novas para a troca valer na hora.
export function setOutputs(list) {
  const next = normOutputs(list);
  if (!next.length) throw new Error('selecione pelo menos uma caixa de saída');
  const namesChanged =
    next.map((o) => o.name).join('|') !== outputs.map((o) => o.name).join('|');
  outputs = next;
  saveConfig();
  if (namesChanged && current) {
    const { file, loop } = current;
    play({ file, loop });
  }
  return status();
}

// Som avulso em todas as caixas, em paralelo (WASAPI mixa) — não mexe no play()
// atual nem é parado pelo stop(). Usado pelo "Iniciar piscar".
export function playOneShot(file) {
  if (!available()) return;
  const wav = resolveSound(file);
  if (!wav) return;
  try {
    spawnCtl(['-Action', 'play', '-Wav', wav]).on('error', () => {});
  } catch { /* silencioso: nunca atrapalha o piscar */ }
}

// Som do "Iniciar piscar" (padrão trovao.mp3; muda em sound-config.json ou ALERT_SOUND).
export function playAlert() {
  playOneShot(alertSound);
}
