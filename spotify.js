// ────────────────────────────────────────────────────────────────────────────
//  spotify — controle do Spotify Connect (Web API oficial).
//
//  Toca/pausa/troca música no MESMO destino que você já usa no app do Spotify.
//  As duas Alexas da sala aparecem aqui como UM único device Connect, desde que
//  estejam num "grupo multi-cômodos" criado no app Alexa (ex.: "Sala"). Basta
//  escolher esse grupo uma vez em /api/spotify/device e todo comando vai nele.
//
//  Requisitos:
//   - conta Spotify PREMIUM (a Web API só controla playback em Premium)
//   - app criado em developer.spotify.com com o Redirect URI abaixo
//
//  Fluxo de login (Authorization Code, uma vez só):
//    GET  /api/spotify/login    → redireciona pro Spotify
//    GET  /api/spotify/callback → troca o code por tokens e salva o refresh_token
//  Depois disso o access_token é renovado sozinho (cache em memória).
//
//  API:
//    status()                  → { configured, linked, device, playlists, ... }
//    setConfig({...})          → salva clientId/clientSecret/playlists (persiste)
//    authUrl()                 → URL de login do Spotify
//    exchangeCode(code)        → troca o code do callback pelo refresh_token
//    logout()                  → esquece o refresh_token
//    listDevices()             → devices do Spotify Connect (as Alexas/grupo)
//    setDevice(id, name)       → fixa o destino padrão dos comandos (persiste)
//    nowPlaying()              → { playing, track, artist, album, art, ... }
//    command(action, value)    → next | previous | play | pause | toggle |
//                                shuffle | volume | playlist | seek
//
//  Config persistida em spotify-config.json (gitignored):
//    { clientId, clientSecret, refreshToken, deviceId, deviceName, playlists }
//  Fallback de credenciais: env SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.
// ────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(__dirname, 'spotify-config.json');

const PORT = Number(process.env.PORT) || 5858;
// O Spotify exige loopback explícito em IPv4 (127.0.0.1, não "localhost") e
// esta URL precisa estar cadastrada IGUAL no dashboard do app.
export const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/api/spotify/callback`;

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

const DEFAULTS = {
  clientId: process.env.SPOTIFY_CLIENT_ID || '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  refreshToken: '',
  deviceId: '',
  deviceName: '',
  playlists: [], // [{ name, uri }] atalhos mostrados na aba Música
};

let cfg = load();
let token = { value: null, expiresAt: 0 }; // access_token em memória

function load() {
  if (!existsSync(cfgPath)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(cfgPath, 'utf-8')) };
  } catch (err) {
    console.error('[spotify] spotify-config.json inválido:', err.message);
    return { ...DEFAULTS };
  }
}

function save() {
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

function basicAuth() {
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
}

function requireApp() {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('Spotify sem credenciais: cadastre Client ID e Client Secret na aba Configuração.');
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

export function authUrl() {
  requireApp();
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'false',
  });
  return `${ACCOUNTS}/authorize?${q}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Spotify token HTTP ${res.status}`);
  }
  return data;
}

export async function exchangeCode(code) {
  requireApp();
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  if (!data.refresh_token) throw new Error('Spotify não devolveu refresh_token.');
  cfg.refreshToken = data.refresh_token;
  save();
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return { ok: true };
}

export function logout() {
  cfg.refreshToken = '';
  save();
  token = { value: null, expiresAt: 0 };
  return status();
}

async function accessToken() {
  requireApp();
  if (!cfg.refreshToken) {
    throw new Error('Spotify não conectado: clique em "Conectar com Spotify" na aba Configuração.');
  }
  if (token.value && Date.now() < token.expiresAt) return token.value;
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
  // O Spotify pode rotacionar o refresh_token; se vier um novo, guardamos.
  if (data.refresh_token && data.refresh_token !== cfg.refreshToken) {
    cfg.refreshToken = data.refresh_token;
    save();
  }
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return token.value;
}

// ── Chamada crua à Web API ──────────────────────────────────────────────────

// Devolve { status, data } — os comandos de player respondem 204 sem corpo.
async function call(method, path, { query, body } = {}) {
  const at = await accessToken();
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${at}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { status: 204, data: null };
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Erro do Spotify em português, já com a dica do caso mais comum.
function apiError({ status, data }) {
  const msg = data?.error?.message || `HTTP ${status}`;
  if (status === 404 && /device/i.test(msg)) {
    return new Error('Nenhum device ativo no Spotify. Escolha o grupo das Alexas na aba Música.');
  }
  if (status === 403 && /premium/i.test(msg)) {
    return new Error('Esse comando exige Spotify Premium.');
  }
  if (status === 403) return new Error(`Spotify recusou o comando: ${msg}`);
  return new Error(`Spotify: ${msg}`);
}

// ── Devices ─────────────────────────────────────────────────────────────────

export async function listDevices() {
  const r = await call('GET', '/me/player/devices');
  if (r.status >= 400) throw apiError(r);
  return (r.data?.devices || []).map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    active: !!d.is_active,
    volume: d.volume_percent,
    restricted: !!d.is_restricted,
    target: d.id === cfg.deviceId,
  }));
}

export function setDevice(deviceId, deviceName) {
  cfg.deviceId = String(deviceId || '');
  cfg.deviceName = String(deviceName || '');
  save();
  return status();
}

// Manda o playback para o device salvo (as Alexas) sem interromper a música.
export async function transfer({ play } = {}) {
  if (!cfg.deviceId) throw new Error('Nenhum device salvo: escolha o grupo das Alexas na aba Música.');
  const r = await call('PUT', '/me/player', { body: { device_ids: [cfg.deviceId], play: !!play } });
  if (r.status >= 400) throw apiError(r);
  return { ok: true, device: cfg.deviceName || cfg.deviceId };
}

// Executa fn; se o Spotify disser "nenhum device ativo", acorda o device salvo
// e tenta de novo. É o que faz o botão funcionar depois das Alexas ficarem ociosas.
async function withDevice(fn) {
  let r = await fn();
  const needsDevice = r.status === 404 || (r.status === 403 && /no active device/i.test(r.data?.error?.message || ''));
  if (needsDevice && cfg.deviceId) {
    await transfer({ play: false }).catch(() => {});
    await new Promise((res) => setTimeout(res, 700));
    r = await fn();
  }
  if (r.status >= 400) throw apiError(r);
  return r;
}

// ── Estado ──────────────────────────────────────────────────────────────────

export async function nowPlaying() {
  const r = await call('GET', '/me/player');
  if (r.status === 204 || !r.data) {
    return { active: false, playing: false, device: cfg.deviceName || null, target: cfg.deviceName || null };
  }
  if (r.status >= 400) throw apiError(r);
  const item = r.data.item || {};
  return {
    active: true,
    playing: !!r.data.is_playing,
    shuffle: !!r.data.shuffle_state,
    repeat: r.data.repeat_state,
    progressMs: r.data.progress_ms || 0,
    durationMs: item.duration_ms || 0,
    track: item.name || null,
    artist: (item.artists || []).map((a) => a.name).join(', ') || null,
    album: item.album?.name || null,
    art: item.album?.images?.[0]?.url || null,
    device: r.data.device?.name || null,
    deviceId: r.data.device?.id || null,
    volume: r.data.device?.volume_percent ?? null,
    onTarget: !!cfg.deviceId && r.data.device?.id === cfg.deviceId,
    target: cfg.deviceName || null,
  };
}

export async function playlists() {
  const r = await call('GET', '/me/playlists', { query: { limit: 50 } });
  if (r.status >= 400) throw apiError(r);
  return (r.data?.items || []).map((p) => ({
    name: p.name,
    uri: p.uri,
    tracks: p.tracks?.total ?? null,
    art: p.images?.[0]?.url || null,
  }));
}

// ── Comandos ────────────────────────────────────────────────────────────────

const DEVICE_Q = () => (cfg.deviceId ? { device_id: cfg.deviceId } : undefined);

// action: next | previous | play | pause | toggle | shuffle | volume | playlist | seek
export async function command(action, value) {
  switch (action) {
    case 'next':
      await withDevice(() => call('POST', '/me/player/next', { query: DEVICE_Q() }));
      break;

    case 'previous':
      await withDevice(() => call('POST', '/me/player/previous', { query: DEVICE_Q() }));
      break;

    case 'play':
      await withDevice(() => call('PUT', '/me/player/play', { query: DEVICE_Q() }));
      break;

    case 'pause':
      await withDevice(() => call('PUT', '/me/player/pause', { query: DEVICE_Q() }));
      break;

    case 'toggle': {
      const st = await nowPlaying();
      return command(st.playing ? 'pause' : 'play');
    }

    case 'shuffle': {
      const on = value === undefined ? !(await nowPlaying()).shuffle : !!value;
      await withDevice(() => call('PUT', '/me/player/shuffle', { query: { state: String(on), ...DEVICE_Q() } }));
      break;
    }

    case 'volume': {
      const v = Math.max(0, Math.min(100, Math.round(Number(value))));
      if (!Number.isFinite(v)) throw new Error('volume inválido (0-100)');
      // Muitas caixas (inclusive Echo) recusam volume via Connect — avisamos claro.
      const r = await call('PUT', '/me/player/volume', { query: { volume_percent: v, ...DEVICE_Q() } });
      if (r.status >= 400) {
        throw new Error('Esse device não aceita volume pelo Spotify — use "Alexa, volume 5" ou o volume do PC.');
      }
      break;
    }

    case 'seek': {
      const ms = Math.max(0, Number(value) || 0);
      await withDevice(() => call('PUT', '/me/player/seek', { query: { position_ms: ms, ...DEVICE_Q() } }));
      break;
    }

    // value = URI de playlist/álbum/artista (spotify:playlist:...) — começa a tocar
    // já no device salvo, mesmo que nada esteja tocando.
    case 'playlist': {
      const uri = String(value || '').trim();
      if (!uri) throw new Error('informe a URI da playlist');
      await withDevice(() =>
        call('PUT', '/me/player/play', { query: DEVICE_Q(), body: { context_uri: uri } })
      );
      break;
    }

    default:
      throw new Error(`ação desconhecida: ${action}`);
  }
  return { ok: true, action };
}

// ── Config / status ─────────────────────────────────────────────────────────

export function setConfig(patch = {}) {
  if (typeof patch.clientId === 'string') cfg.clientId = patch.clientId.trim();
  if (typeof patch.clientSecret === 'string') cfg.clientSecret = patch.clientSecret.trim();
  if (Array.isArray(patch.playlists)) {
    cfg.playlists = patch.playlists
      .filter((p) => p && p.uri)
      .map((p) => ({ name: String(p.name || p.uri), uri: String(p.uri) }));
  }
  save();
  token = { value: null, expiresAt: 0 }; // credenciais mudaram → invalida o cache
  return status();
}

export function status() {
  return {
    configured: !!(cfg.clientId && cfg.clientSecret),
    linked: !!cfg.refreshToken,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    deviceId: cfg.deviceId,
    deviceName: cfg.deviceName,
    playlists: cfg.playlists,
    redirectUri: REDIRECT_URI,
  };
}
