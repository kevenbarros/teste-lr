// ────────────────────────────────────────────────────────────────────────────
//  lendas — integração com a aplicação "financas-lendas" (Firebase/Firestore).
//
//  Usado pelo botão "Finalizar jogo": lista as equipes do dia (sessions com a
//  data de hoje) e grava o tempo da equipe no ranking (rankingEntries) — o
//  mesmo dado que o RankingForm da financas-lendas salva.
//
//  Autentica com Service Account (firebase-admin), então IGNORA as regras do
//  Firestore — não precisa de e-mail/senha de staff.
//
//  API:
//    configured()            → há service account disponível?
//    listTeamsToday()        → [{ id, roomId, roomName, date, startTime,
//                                  endTime, customerName, status, players }]
//    saveRanking({ sessionId, timeSeconds, teamName?, members? })
//
//  Config em lendas-config.json (gitignored):
//    { "serviceAccountPath": "./lendas-service-account.json", "roomId": "" }
//  Alternativamente pode embutir a chave inteira em "serviceAccount": { ... }.
//  "roomId" (opcional) filtra as equipes para uma única sala; vazio = todas.
// ────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(__dirname, 'lendas-config.json');
const DEFAULT_SA_PATH = './lendas-service-account.json';

let _cfg = null;   // null = não lido ainda, false = ausente/ inválido
let _db = null;

function loadCfg() {
  if (_cfg !== null) return _cfg;
  if (!existsSync(cfgPath)) {
    _cfg = false;
    return _cfg;
  }
  try {
    _cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch (err) {
    console.error('[lendas] lendas-config.json inválido:', err.message);
    _cfg = false;
  }
  return _cfg;
}

function resolveServiceAccount(cfg) {
  if (cfg.serviceAccount && typeof cfg.serviceAccount === 'object') {
    return cfg.serviceAccount;
  }
  const p = cfg.serviceAccountPath || DEFAULT_SA_PATH;
  const abs = isAbsolute(p) ? p : join(__dirname, p);
  if (!existsSync(abs)) {
    throw new Error(
      `Service account não encontrado (${p}). Gere a chave em Firebase Console → ` +
      'Configurações do projeto → Contas de serviço → Gerar nova chave privada, ' +
      'e salve como lendas-service-account.json.',
    );
  }
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

export function configured() {
  const cfg = loadCfg();
  if (!cfg) return false;
  try {
    resolveServiceAccount(cfg);
    return true;
  } catch {
    return false;
  }
}

function db() {
  if (_db) return _db;
  const cfg = loadCfg();
  if (!cfg) {
    throw new Error('Integração com a financas-lendas não configurada (crie lendas-config.json).');
  }
  const serviceAccount = resolveServiceAccount(cfg);
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert(serviceAccount) });
  _db = getFirestore(app);
  return _db;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Equipes de hoje: sessions com a data de hoje (exceto canceladas). */
export async function listTeamsToday() {
  const firestore = db();
  const cfg = loadCfg();
  const today = todayISO();

  // Só filtramos por date no Firestore (uma igualdade, sem índice composto);
  // o filtro de sala é feito em memória para não depender de índice.
  const snap = await firestore.collection('sessions').where('date', '==', today).get();

  // Nomes das salas para exibir quando houver mais de uma.
  const rooms = {};
  try {
    const rsnap = await firestore.collection('rooms').get();
    rsnap.forEach((d) => { rooms[d.id] = d.data().name || ''; });
  } catch { /* rooms é best-effort */ }

  const teams = [];
  snap.forEach((d) => {
    const s = d.data();
    if (s.status === 'cancelado') return;
    if (cfg.roomId && s.roomId !== cfg.roomId) return;
    teams.push({
      id: d.id,
      roomId: s.roomId,
      roomName: rooms[s.roomId] || '',
      date: s.date,
      startTime: s.startTime || '',
      endTime: s.endTime || '',
      customerName: s.customerName || '',
      status: s.status,
      players: s.playersFinal ?? s.playersEstimated ?? null,
    });
  });

  teams.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  return teams;
}

/**
 * Grava (ou atualiza) a entrada de ranking de uma sessão. O doc id é o próprio
 * sessionId — igual ao saveRankingEntry da financas-lendas — para editar/apagar
 * junto. Preserva teamName/members já existentes quando não forem informados,
 * evitando sobrescrever dados mais ricos digitados na financas-lendas.
 */
export async function saveRanking({ sessionId, timeSeconds, teamName, members } = {}) {
  const firestore = db();
  if (!sessionId) throw new Error('sessionId obrigatório.');

  const secs = Math.round(Number(timeSeconds));
  if (!Number.isFinite(secs) || secs <= 0) {
    throw new Error('Tempo inválido (informe minutos e segundos).');
  }

  const sessRef = firestore.collection('sessions').doc(sessionId);
  const sessSnap = await sessRef.get();
  if (!sessSnap.exists) throw new Error('Sessão não encontrada.');
  const sess = sessSnap.data();
  if (!sess.date) throw new Error('Sessão sem data definida.');

  const rankRef = firestore.collection('rankingEntries').doc(sessionId);
  const existingSnap = await rankRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;

  const finalTeamName =
    (teamName && String(teamName).trim()) ||
    existing?.teamName ||
    sess.customerName ||
    'Equipe';
  const finalMembers = Array.isArray(members) && members.length
    ? members
    : (existing?.members ?? []);

  await rankRef.set({
    roomId: sess.roomId,
    date: sess.date,
    teamName: finalTeamName,
    members: finalMembers,
    timeSeconds: secs,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: existing?.createdBy || 'lampada-relogio',
  });

  return { ok: true, sessionId, timeSeconds: secs, teamName: finalTeamName };
}
