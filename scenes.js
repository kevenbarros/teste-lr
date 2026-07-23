// ────────────────────────────────────────────────────────────────────────────
//  scenes — "um botão faz várias coisas".
//
//  Uma cena é uma lista de passos executados EM ORDEM. Um passo que falha não
//  aborta a cena (a luz apagar não pode depender do Spotify responder): o passo
//  vira { ok:false, error } no resultado e a execução continua.
//
//  Tipos de passo:
//    { type:'spotify', action:'next|previous|play|pause|toggle|shuffle|volume|playlist', value? }
//    { type:'lamp',    match:'quarto', on:false }      // match = regex no nome da lâmpada
//    { type:'lamp',    id:'eb60...',   on:true }       // ou o id exato de devices.json
//    { type:'ir',      blaster:'quarto', device:'tv', key:'power' }
//    { type:'sound',   file:'trovao.mp3' }
//    { type:'wait',    ms:800 }
//
//  As cenas ficam em scenes.json (versionado — não tem segredo nenhum, as
//  lâmpadas são referenciadas por nome). O executor recebe as ações do server.js
//  por injeção, então este módulo não conhece Tuya nem Spotify.
//
//  API:
//    createScenes({ file, actions }) → { list(), get(id), run(id), save(list) }
// ────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rótulo curto de cada passo, usado no resultado e na UI.
export function describeStep(step) {
  switch (step?.type) {
    case 'spotify': {
      const label = {
        next: 'Próxima música',
        previous: 'Música anterior',
        play: 'Tocar',
        pause: 'Pausar',
        toggle: 'Tocar/Pausar',
        shuffle: 'Aleatório',
        volume: `Volume ${step.value}%`,
        playlist: `Playlist ${step.name || step.value}`,
      }[step.action];
      return `Spotify: ${label || step.action}`;
    }
    case 'lamp':
      return `Lâmpada ${step.match || step.id}: ${step.on ? 'ligar' : 'desligar'}`;
    case 'ir':
      return `IR ${step.device}: ${step.key}`;
    case 'sound':
      return `Som: ${step.file}`;
    case 'wait':
      return `Esperar ${step.ms}ms`;
    default:
      return `Passo ${step?.type || '?'}`;
  }
}

export function createScenes({ file, actions }) {
  function load() {
    if (!existsSync(file)) return { scenes: [] };
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8'));
      return { scenes: Array.isArray(raw.scenes) ? raw.scenes : [] };
    } catch (err) {
      console.error('[cenas] scenes.json inválido:', err.message);
      return { scenes: [] };
    }
  }

  function list() {
    return load().scenes.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon || '✨',
      description: s.description || '',
      steps: (s.steps || []).map((st) => ({ ...st, label: describeStep(st) })),
    }));
  }

  function get(id) {
    return load().scenes.find((s) => s.id === id) || null;
  }

  function save(scenes) {
    if (!Array.isArray(scenes)) throw new Error('esperado um array de cenas');
    for (const s of scenes) {
      if (!s.id || !s.name) throw new Error('toda cena precisa de "id" e "name"');
      if (!Array.isArray(s.steps)) throw new Error(`cena "${s.id}" sem "steps"`);
    }
    writeFileSync(file, JSON.stringify({ scenes }, null, 2));
    return list();
  }

  async function runStep(step) {
    switch (step.type) {
      case 'spotify':
        return actions.spotify(step.action, step.value);
      case 'lamp':
        return actions.lamp({ match: step.match, id: step.id, on: !!step.on });
      case 'ir':
        return actions.ir({ blaster: step.blaster, device: step.device, key: step.key });
      case 'sound':
        return actions.sound(step.file);
      case 'wait':
        return sleep(Math.max(0, Math.min(10000, Number(step.ms) || 0)));
      default:
        throw new Error(`tipo de passo desconhecido: ${step.type}`);
    }
  }

  async function run(id) {
    const scene = get(id);
    if (!scene) throw new Error(`cena "${id}" não encontrada`);

    const results = [];
    for (const step of scene.steps || []) {
      const label = describeStep(step);
      try {
        await runStep(step);
        results.push({ label, ok: true });
      } catch (err) {
        console.error(`[cena ${id}] falhou em "${label}":`, err.message);
        results.push({ label, ok: false, error: err.message });
      }
    }
    return { ok: results.every((r) => r.ok), scene: scene.name, results };
  }

  return { list, get, run, save };
}
