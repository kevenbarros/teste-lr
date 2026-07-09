import { useState } from 'react';
import { lampsApi as api } from '../lib/lampsApi.js';
import '../pages/Lamps.css';

// Card de controle de uma lâmpada Tuya: ligar/desligar, piscar (com intervalo e
// duração), flicker e parar efeito. Reutilizado nas abas Quarto e Porão.
export default function LampCard({ lamp, onChange }) {
  const [busy, setBusy] = useState(false);
  const [blinkMs, setBlinkMs] = useState(500);
  const [blinkDurationS, setBlinkDurationS] = useState(5);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { alert(err.message); }
    setBusy(false);
    onChange?.();
  };

  const cardClass = ['lamp-card', lamp.connected ? 'online' : 'offline'].join(' ');

  return (
    <div className={cardClass}>
      <div className="lamp-card-header">
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
        <button className="lamp-primary on" disabled={busy} onClick={() => run(() => api.switch(lamp.id, true))}>
          Ligar
        </button>
        <button className="lamp-primary off" disabled={busy} onClick={() => run(() => api.switch(lamp.id, false))}>
          Desligar
        </button>
      </div>

      <div className="lamp-divider"><span>piscar</span></div>

      <div className="lamp-settings">
        <div className="lamp-slider-row">
          <label>Intervalo (ms)</label>
          <input
            type="number" min="100" max="5000" step="50"
            value={blinkMs}
            onChange={(e) => setBlinkMs(Number(e.target.value))}
          />
        </div>
        <div className="lamp-slider-row">
          <label>Duração (s, 0 = ∞)</label>
          <input
            type="number" min="0" max="600" step="1"
            value={blinkDurationS}
            onChange={(e) => setBlinkDurationS(Number(e.target.value))}
          />
        </div>
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
