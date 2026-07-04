// ────────────────────────────────────────────────────────────────────────────
//  soundPlayer — toca sons SOMENTE na caixa configurada (padrão: SoundCore 2).
//
//  Reproduz qualquer arquivo de sounds/ (wav/mp3) direto no endpoint WASAPI do
//  dispositivo escolhido, sem trocar o dispositivo padrão: o fone continua
//  tocando e a caixa não espelha o áudio do sistema — só o que este módulo manda.
//
//  API:
//    listSounds()                       → nomes de arquivos disponíveis
//    listDevices()                      → Promise<string[]> saídas de áudio ativas
//    play({ file, volume, loop })       → toca (troca o que estava tocando)
//    stop()                             → para a reprodução atual
//    setVolume(v)                       → ajusta o volume da caixa AO VIVO (0-100)
//    setDevice(name)                    → troca a caixa de saída (persiste)
//    status()                           → { playing, file, loop, volume, device }
//    playOneShot(file, volume)          → som curto avulso (não interrompe o
//                                         play() atual; usado pelo "Iniciar piscar")
//    playAlert()                        → som do "Iniciar piscar" (alertSound)
//
//  Config persistida em sound-config.json (criado ao salvar; gitignored):
//    { "device": "...", "volume": 40, "alertSound": "trovao.mp3" }
//  Fallbacks: env ALERT_DEVICE / ALERT_VOLUME / ALERT_SOUND, depois padrões.
//  "device" pode ser o nome EXATO do endpoint (ex.: "Fones de ouvido (SoundCore
//  2)", vindo do seletor da página Sons) ou um trecho (ex.: "SoundCore 2").
//
//  Implementação: cada reprodução é um processo PowerShell (scripts/sound-ctl.ps1
//  + tools/NAudio.dll). "Parar" = matar o processo.
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

const cfg = loadConfig();
let device = cfg.device || process.env.ALERT_DEVICE || 'SoundCore 2';
let volume = clampVol(cfg.volume ?? process.env.ALERT_VOLUME ?? 40);
let alertSound = cfg.alertSound || process.env.ALERT_SOUND || 'trovao.mp3';

function saveConfig() {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ device, volume, alertSound }, null, 2) + '\n');
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

function spawnCtl(extraArgs, opts = {}) {
  return spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1,
      '-Dll', DLL, '-DeviceMatch', device, ...extraArgs],
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
    const child = spawnCtl(['-Action', 'list'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
    child.on('error', () => resolve([]));
    setTimeout(() => { try { child.kill(); } catch { /* já saiu */ } }, 8000);
  });
}

export function status() {
  return { playing: !!current, file: current?.file || null, loop: current?.loop || false, volume, device };
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
  if (vol != null) { volume = clampVol(vol); saveConfig(); }

  stop(); // uma reprodução controlável por vez

  const args = ['-Action', 'play', '-Wav', wav, '-Volume', String(volume)];
  if (loop) args.push('-Loop');
  const child = spawnCtl(args);
  const entry = { child, file: basename(wav), loop: !!loop };
  current = entry;
  child.on('exit', () => { if (current === entry) current = null; });
  child.on('error', (err) => { if (current === entry) current = null; console.warn('[som] falhou:', err.message); });
  return status();
}

export function setVolume(vol) {
  volume = clampVol(vol);
  saveConfig();
  // Aplica ao endpoint sem interromper a reprodução em andamento.
  if (available()) {
    try { spawnCtl(['-Action', 'volume', '-Volume', String(volume)]).on('error', () => {}); } catch { /* ignora */ }
  }
  return status();
}

// Troca a caixa de saída (persiste). Se algo estava tocando, reinicia o mesmo
// som no novo dispositivo para a troca valer na hora.
export function setDevice(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('nome do dispositivo vazio');
  device = n;
  saveConfig();
  if (current) {
    const { file, loop } = current;
    play({ file, loop });
  }
  return status();
}

// Som curto avulso, tocado em paralelo (WASAPI mixa) — não mexe no play() atual
// nem é parado pelo stop(). Usado pelo "Iniciar piscar".
export function playOneShot(file, vol = volume) {
  if (!available()) return;
  const wav = resolveSound(file);
  if (!wav) return;
  try {
    spawnCtl(['-Action', 'play', '-Wav', wav, '-Volume', String(clampVol(vol))]).on('error', () => {});
  } catch { /* silencioso: nunca atrapalha o piscar */ }
}

// Som do "Iniciar piscar" (padrão trovao.mp3; muda em sound-config.json ou ALERT_SOUND).
export function playAlert() {
  playOneShot(alertSound);
}
