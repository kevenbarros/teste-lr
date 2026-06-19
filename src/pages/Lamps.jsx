import { useEffect, useMemo, useState } from 'react';
import { lampsApi as api } from '../lib/lampsApi.js';
import './Lamps.css';

const ORDER_KEY = 'lamps:order';

function loadOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveOrder(ids) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch {}
}

function sortByOrder(lamps, order) {
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...lamps].sort((a, b) => {
    const ai = idx.has(a.id) ? idx.get(a.id) : Infinity;
    const bi = idx.has(b.id) ? idx.get(b.id) : Infinity;
    return ai - bi;
  });
}

export default function Lamps() {
  const [lamps, setLamps] = useState([]);
  const [error, setError] = useState(null);
  const [order, setOrder] = useState(loadOrder);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const refresh = async () => {
    try {
      const data = await api.list();
      setLamps(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const sortedLamps = useMemo(() => sortByOrder(lamps, order), [lamps, order]);

  function handleReorder(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const ids = sortedLamps.map(l => l.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);
    saveOrder(next);
  }

  return (
    <div className="lamps-page">
      <h1>Minhas lâmpadas</h1>
      {error && <div className="lamps-error">Erro: {error}</div>}
      <QuartoAutomation />
      <div className="lamps-grid">
        {sortedLamps.map(lamp => (
          <LampCard
            key={lamp.id}
            lamp={lamp}
            onChange={refresh}
            dragging={dragId === lamp.id}
            dropTarget={overId === lamp.id && dragId && dragId !== lamp.id}
            onDragStart={() => setDragId(lamp.id)}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={() => setOverId(lamp.id)}
            onDrop={(fromId) => handleReorder(fromId, lamp.id)}
          />
        ))}
      </div>
      {lamps.length === 0 && !error && <p>Carregando...</p>}
    </div>
  );
}

function QuartoAutomation() {
  const [running, setRunning] = useState(null);

  const run = async (label, fn) => {
    setRunning(label);
    try {
      await fn();
      setTimeout(() => setRunning(null), 5200);
    } catch (err) {
      alert(err.message);
      setRunning(null);
    }
  };

  return (
    <div className="lamp-card automation">
      <div className="lamp-card-header">
        <h2>Automação Quarto (entrada + saída)</h2>
      </div>
      <p>Pisca por 5s (entrada 100ms / saída 200ms) e termina no estado escolhido.</p>
      <div className="lamp-row">
        <button disabled={!!running} onClick={() => run('on', api.quartoPiscar)}>
          {running === 'on' ? 'Executando...' : 'Piscar e acender'}
        </button>
        <button disabled={!!running} onClick={() => run('off', api.quartoPiscarDesligar)}>
          {running === 'off' ? 'Executando...' : 'Piscar e desligar'}
        </button>
      </div>
    </div>
  );
}

function LampCard({ lamp, onChange, dragging, dropTarget, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const [busy, setBusy] = useState(false);
  const [blinkMs, setBlinkMs] = useState(500);
  const [blinkDurationS, setBlinkDurationS] = useState(5);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { alert(err.message); }
    setBusy(false);
    onChange();
  };

  const cardClass = [
    'lamp-card',
    lamp.connected ? 'online' : 'offline',
    dragging ? 'dragging' : '',
    dropTarget ? 'drop-target' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClass}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lamp-id', lamp.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.(); }}
      onDrop={(e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData('text/lamp-id');
        onDrop?.(fromId);
      }}
    >
      <div className="lamp-card-header">
        <span className="lamp-drag-handle" title="Arraste para reordenar">⋮⋮</span>
        <h2>{lamp.name}</h2>
        <span className={`lamp-status ${lamp.connected ? 'ok' : 'bad'}`}>
          {lamp.connected ? 'conectada' : 'desconectada'}
        </span>
        {lamp.connected && (
          <span className={`lamp-status ${lamp.on ? 'ok' : 'bad'}`}>
            {lamp.on === null ? '...' : lamp.on ? 'ligada' : 'desligada'}
          </span>
        )}
      </div>

      {lamp.effect && <div className="lamp-effect-badge">efeito ativo: {lamp.effect}</div>}

      <div className="lamp-row">
        <button disabled={busy} onClick={() => run(() => api.switch(lamp.id, true))}>
          Ligar
        </button>
        <button disabled={busy} onClick={() => run(() => api.switch(lamp.id, false))}>
          Desligar
        </button>
      </div>

      <div className="lamp-slider-row">
        <label>Intervalo do blink (ms):</label>
        <input
          type="number" min="100" max="5000" step="50"
          value={blinkMs}
          onChange={e => setBlinkMs(Number(e.target.value))}
        />
      </div>

      <div className="lamp-slider-row">
        <label>Duração (s, 0 = infinito):</label>
        <input
          type="number" min="0" max="600" step="1"
          value={blinkDurationS}
          onChange={e => setBlinkDurationS(Number(e.target.value))}
        />
      </div>

      <div className="lamp-row">
        <button disabled={busy}
          onClick={() => run(() => api.blink(lamp.id, blinkMs, blinkDurationS * 1000, false))}>
          {blinkDurationS > 0 ? `Piscar ${blinkDurationS}s e desligar` : 'Piscar (desliga)'}
        </button>
        <button disabled={busy}
          onClick={() => run(() => api.blink(lamp.id, blinkMs, blinkDurationS * 1000, true))}>
          {blinkDurationS > 0 ? `Piscar ${blinkDurationS}s e ligar` : 'Piscar (liga)'}
        </button>
      </div>
      <div className="lamp-row">
        <button disabled={busy} onClick={() => run(() => api.flicker(lamp.id))}>
          Falhando (flicker)
        </button>
        <button disabled={busy} onClick={() => run(() => api.stop(lamp.id))}>
          Parar efeito
        </button>
      </div>
    </div>
  );
}
