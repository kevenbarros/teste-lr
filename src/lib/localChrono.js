import { useEffect, useState } from 'react';

const KEY = 'sixled:localChrono';
const EVT = 'sixled:chrono-changed';
export const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_PREP_MS = 3000;               // 3, 2, 1

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    window.dispatchEvent(new Event(EVT));
  } catch {}
}

// Start: if paused, resumes without prep; otherwise runs the 3-2-1 prep
// then transitions automatically into running.
export function startChrono(durationMs = DEFAULT_DURATION_MS, prepMs = DEFAULT_PREP_MS) {
  const c = load();
  const now = Date.now();
  if (c?.state === 'paused' && c.remainingMs > 0) {
    save({ state: 'running', endsAt: now + c.remainingMs, durationMs: c.durationMs });
    return;
  }
  save({
    state: 'preparing',
    prepEndsAt: now + prepMs,
    endsAt: now + prepMs + durationMs,
    durationMs,
  });
}

// Force a fresh start (used by the Restart button) — bypasses pause-resume.
export function restartChrono(durationMs = DEFAULT_DURATION_MS, prepMs = DEFAULT_PREP_MS) {
  const now = Date.now();
  save({
    state: 'preparing',
    prepEndsAt: now + prepMs,
    endsAt: now + prepMs + durationMs,
    durationMs,
  });
}

export function pauseChrono() {
  const c = load();
  if (!c) return;
  const now = Date.now();
  // Only meaningful once the chrono is actually running.
  if (c.state === 'running' || (c.state === 'preparing' && now >= c.prepEndsAt)) {
    const remainingMs = Math.max(0, c.endsAt - now);
    save({ state: 'paused', remainingMs, durationMs: c.durationMs });
  }
}

export function stopChrono(durationMs = DEFAULT_DURATION_MS) {
  const c = load();
  const d = c?.durationMs ?? durationMs;
  save({ state: 'idle', remainingMs: d, durationMs: d });
}

// Adds (or subtracts, if negative) time to the chronometer in any state.
// running/preparing: shifts endsAt; paused/idle: adjusts remainingMs;
// finished: revives as running with the added time.
export function addChronoTime(extraMs) {
  const c = load();
  const now = Date.now();
  if (!c) return;
  if (c.state === 'running' || c.state === 'preparing') {
    save({ ...c, endsAt: Math.max(now, c.endsAt + extraMs) });
  } else if (c.state === 'paused') {
    save({ ...c, remainingMs: Math.max(0, c.remainingMs + extraMs) });
  } else if (c.state === 'idle') {
    const next = Math.max(0, (c.remainingMs ?? c.durationMs) + extraMs);
    save({ ...c, remainingMs: next });
  } else if (c.state === 'finished' && extraMs > 0) {
    save({ state: 'running', endsAt: now + extraMs, durationMs: c.durationMs });
  }
}

export function formatChronoTime(totalMs) {
  const t = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function msToHHMMSS(totalMs) {
  const t = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function getChronoSnapshot() {
  return readDisplay();
}

function readDisplay() {
  const c = load();
  if (!c) return { state: 'idle', remainingMs: DEFAULT_DURATION_MS, durationMs: DEFAULT_DURATION_MS, prepRemainingMs: 0 };
  const now = Date.now();

  if (c.state === 'preparing') {
    const prepRemainingMs = c.prepEndsAt - now;
    if (prepRemainingMs > 0) {
      return { state: 'preparing', prepRemainingMs, remainingMs: c.durationMs, durationMs: c.durationMs };
    }
    // Prep ended → running phase
    const remainingMs = Math.max(0, c.endsAt - now);
    return {
      state: remainingMs === 0 ? 'finished' : 'running',
      remainingMs,
      durationMs: c.durationMs,
      prepRemainingMs: 0,
    };
  }

  if (c.state === 'running') {
    const remainingMs = Math.max(0, c.endsAt - now);
    return {
      state: remainingMs === 0 ? 'finished' : 'running',
      remainingMs,
      durationMs: c.durationMs,
      prepRemainingMs: 0,
    };
  }

  return {
    state: c.state,
    remainingMs: c.remainingMs ?? c.durationMs,
    durationMs: c.durationMs,
    prepRemainingMs: 0,
  };
}

export function useChrono({ intervalMs = 200 } = {}) {
  const [snapshot, setSnapshot] = useState(readDisplay);

  useEffect(() => {
    let alive = true;
    function refresh() { if (alive) setSnapshot(readDisplay()); }
    refresh();
    const id = setInterval(refresh, intervalMs);
    window.addEventListener(EVT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener(EVT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [intervalMs]);

  return snapshot;
}

// Display helper that picks the right text based on state.
export function chronoDisplayText(snapshot) {
  if (snapshot.state === 'preparing') {
    return String(Math.max(1, Math.ceil(snapshot.prepRemainingMs / 1000)));
  }
  return formatChronoTime(snapshot.remainingMs);
}
