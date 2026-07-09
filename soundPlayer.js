// ────────────────────────────────────────────────────────────────────────────
//  soundPlayer — toca sons SOMENTE nas caixas configuradas (1..N ao mesmo tempo).
//
//  Reproduz qualquer arquivo de sounds/ (wav/mp3) direto nos endpoints WASAPI
//  dos dispositivos escolhidos, sem trocar o dispositivo padrão: o fone continua
//  tocando e as caixas não espelham o áudio do sistema — só o que este módulo manda.
//
//  Dois níveis de volume, independentes e multiplicativos:
//   - volume POR CAIXA  → volume do endpoint (MasterVolumeLevelScalar) no ps1
//   - volume POR SOM    → ganho do stream (AudioFileReader.Volume), -Gain no ps1
//  Volume que se ouve ≈ (volume da caixa) × (volume do som).
//
//  API:
//    listSounds()                       → nomes de arquivos disponíveis
//    listDevices()                      → Promise<string[]> saídas de áudio ativas
//    play({ file, loop })               → toca em TODAS as caixas, no volume do som
//    stop()                             → para a reprodução controlável (não o alerta)
//    stopAlert()                        → para o som do "Iniciar piscar"
//    stopAll()                          → para tudo (controlável + alerta)
//    setVolume(v, deviceName?)          → volume da caixa AO VIVO (todas ou uma)
//    setSoundVolume(file, v)            → volume específico de um som (persiste)
//    setOutputs([{ name, volume }])     → define as caixas de saída (persiste)
//    status()                           → { playing, file, loop, outputs, soundVolumes, alertPlaying }
//    playAlert()                        → som do "Iniciar piscar" (alertSound), rastreável/parável
//
//  Config persistida em sound-config.json (gitignored):
//    { outputs:[{name,volume}], soundVolumes:{ "arquivo": 0-100 }, alertSound }
//  Migra formato antigo { device, volume }. Fallbacks: env ALERT_DEVICE /
//  ALERT_VOLUME / ALERT_SOUND, depois "SoundCore 2" / 40 / trovao.mp3.
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
let soundVolumes = (cfg.soundVolumes && typeof cfg.soundVolumes === 'object') ? { ...cfg.soundVolumes } : {};
let alertSound = cfg.alertSound || process.env.ALERT_SOUND || 'trovao.mp3';

function saveConfig() {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ outputs, soundVolumes, alertSound }, null, 2) + '\n');
  } catch (err) {
    console.warn('[som] não consegui salvar sound-config.json:', err.message);
  }
}

let current = null; // reprodução controlável { child, file, loop, startedAt, durationMs }
let alert = null;   // som do "Iniciar piscar" { child, file, startedAt, durationMs }
let soundDurations = {}; // arquivo → duração em ms (carregado no início)

function available() {
  return process.platform === 'win32' && existsSync(DLL) && existsSync(PS1);
}

// Carrega a duração de cada som (uma vez) via NAudio, sem tocar nada.
function loadDurations() {
  if (!available()) return;
  let out = '';
  const child = spawnCtl(['-Action', 'durations', '-Dir', SOUNDS_DIR], outputs, { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { out += d; });
  child.on('exit', () => {
    for (const line of out.split(/\r?\n/)) {
      const i = line.lastIndexOf('|');
      if (i <= 0) continue;
      const name = line.slice(0, i).trim();
      const sec = parseFloat(line.slice(i + 1));
      if (name && sec > 0) soundDurations[name] = Math.round(sec * 1000);
    }
  });
  child.on('error', () => {});
}

// Resolve um nome de som para caminho seguro dentro de sounds/ (sem path traversal).
function resolveSound(file) {
  const name = basename(String(file || ''));
  if (!EXTS.has(extname(name).toLowerCase())) return null;
  const p = join(SOUNDS_DIR, name);
  return existsSync(p) ? p : null;
}

// Volume configurado para um som (0-100); padrão 100 (sem atenuação).
function gainFor(file) {
  const v = soundVolumes[basename(file)];
  return v == null ? 100 : clampVol(v);
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

// Inicia a reprodução de um wav (nas caixas configuradas), já com o ganho do som,
// e devolve um "entry" que cronometra o progresso a partir do marcador STARTED.
function startPlayback(wav, { loop = false } = {}) {
  const args = ['-Action', 'play', '-Wav', wav, '-Gain', String(gainFor(wav))];
  if (loop) args.push('-Loop');
  const child = spawnCtl(args, outputs, { stdio: ['ignore', 'pipe', 'ignore'] });
  const entry = {
    child,
    file: basename(wav),
    loop: !!loop,
    startedAt: 0, // setado quando o áudio realmente começa (STARTED)
    durationMs: soundDurations[basename(wav)] || 0,
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { if (!entry.startedAt && d.includes('STARTED')) entry.startedAt = Date.now(); });
  return entry;
}

// Posição/duração da reprodução ativa (controlável tem prioridade sobre o alerta).
function progress() {
  const active = current || alert;
  if (!active) return { positionMs: 0, durationMs: 0 };
  const durationMs = active.durationMs || soundDurations[active.file] || 0;
  let positionMs = 0;
  if (active.startedAt) {
    const elapsed = Date.now() - active.startedAt;
    positionMs = active.loop && durationMs ? elapsed % durationMs : Math.min(elapsed, durationMs || elapsed);
  }
  return { positionMs, durationMs };
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
    soundVolumes: { ...soundVolumes },
    durations: { ...soundDurations },
    alertPlaying: !!alert,
    alertSound,
    ...progress(), // positionMs, durationMs (da reprodução ativa)
  };
}

export function stop() {
  if (current?.child) { try { current.child.kill(); } catch { /* já morreu */ } }
  current = null;
  return status();
}

export function stopAlert() {
  if (alert?.child) { try { alert.child.kill(); } catch { /* já morreu */ } }
  alert = null;
  return status();
}

export function stopAll() {
  stop();
  stopAlert();
  return status();
}

export function play({ file, loop = false } = {}) {
  if (!available()) throw new Error('reprodução de som indisponível (requer Windows + tools/NAudio.dll)');
  const wav = resolveSound(file);
  if (!wav) throw new Error(`som "${file}" não encontrado em sounds/`);

  stop(); // uma reprodução controlável por vez

  const entry = startPlayback(wav, { loop });
  current = entry;
  entry.child.on('exit', () => { if (current === entry) current = null; });
  entry.child.on('error', (err) => { if (current === entry) current = null; console.warn('[som] falhou:', err.message); });
  return status();
}

// Volume da CAIXA ao vivo (não interrompe a reprodução). Com deviceName, só aquela.
export function setVolume(vol, deviceName) {
  const v = clampVol(vol);
  const name = String(deviceName || '').trim();
  let changed;
  if (name) {
    if (!outputs.some((o) => o.name === name)) throw new Error(`caixa "${name}" não está nas saídas configuradas`);
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

// Volume específico de um som (0-100). Vale na PRÓXIMA vez que o som tocar.
export function setSoundVolume(file, vol) {
  const name = basename(String(file || ''));
  if (!resolveSound(name)) throw new Error(`som "${file}" não encontrado em sounds/`);
  soundVolumes[name] = clampVol(vol);
  saveConfig();
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

// Som do "Iniciar piscar" — toca nas caixas configuradas, no volume do próprio
// som, e fica rastreado em alertProc para poder ser parado (stopAlert/stopAll).
export function playAlert() {
  if (!available()) return;
  const wav = resolveSound(alertSound);
  if (!wav) return;
  stopAlert(); // um alerta por vez
  try {
    const entry = startPlayback(wav, { loop: false });
    alert = entry;
    entry.child.on('exit', () => { if (alert === entry) alert = null; });
    entry.child.on('error', () => { if (alert === entry) alert = null; });
  } catch { /* silencioso: nunca atrapalha o piscar */ }
}

loadDurations(); // pré-carrega as durações dos sons ao subir
