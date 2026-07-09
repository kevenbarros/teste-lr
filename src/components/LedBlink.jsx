import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import { IR_DEVICE } from '../lib/useIrLocal.js';
import '../pages/PlanoB.css';

// Piscar da fita de LED (alterna ON/OFF). Dispara também o som na(s) caixa(s)
// ao iniciar (isso acontece no servidor). Recebe info/refresh do useIrLocal.
export default function LedBlink({ info, refresh }) {
  const [busy, setBusy] = useState(null);
  const [intervalMs, setIntervalMs] = useState(800);

  const learned = info?.devices?.[IR_DEVICE]?.keys || [];
  const hasOn = learned.includes('on');
  const hasOff = learned.includes('off');
  const blinking = info?.effect === 'blink';

  const run = async (tag, fn) => {
    setBusy(tag);
    try {
      await fn();
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="planob-card">
      <h2>Piscar {blinking && <span className="planob-blinking">● piscando</span>}</h2>
      <p className="planob-hint">Alterna LIGAR/DESLIGAR continuamente. Ajuste a velocidade abaixo.</p>

      <div className="planob-slider">
        <label>Intervalo: <strong>{intervalMs} ms</strong> ({(1000 / intervalMs).toFixed(1)}x por segundo)</label>
        <input
          type="range" min="300" max="3000" step="50"
          value={intervalMs}
          onChange={(e) => setIntervalMs(Number(e.target.value))}
          onPointerUp={(e) => { if (blinking) irLocalApi.blink(IR_DEVICE, Number(e.target.value)).catch(() => {}); }}
        />
        <div className="planob-slider-ends"><span>rápido (300ms)</span><span>lento (3s)</span></div>
      </div>

      <div className="planob-row">
        <button className="action blink" disabled={!hasOn || !hasOff || !!busy}
          onClick={() => run('blink', () => irLocalApi.blink(IR_DEVICE, intervalMs))}>
          {blinking ? 'Atualizar velocidade' : 'Iniciar piscar'}
        </button>
        <button className="action stop" disabled={!blinking && !busy}
          onClick={() => run('stop', () => irLocalApi.stop())}>
          Parar
        </button>
      </div>
      {(!hasOn || !hasOff) && <p className="planob-hint">Precisa dos botões "on" e "off" aprendidos (aba Configuração).</p>}
    </section>
  );
}
