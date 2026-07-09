import { useState } from 'react';
import { lampsApi as api } from '../lib/lampsApi.js';
import '../pages/Lamps.css';

// Automação do quarto: pisca entrada+saída por 5s e termina no estado escolhido.
export default function QuartoAutomation() {
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
      <div className="automation-info">
        <h2>⚡ Automação <span className="automation-tag">entrada + saída</span></h2>
        <p>Pisca por 5s (entrada 100ms / saída 200ms) e termina no estado escolhido.</p>
      </div>
      <div className="automation-actions">
        <button className="on" disabled={!!running} onClick={() => run('on', api.quartoPiscar)}>
          {running === 'on' ? 'Executando…' : 'Piscar e acender'}
        </button>
        <button className="off" disabled={!!running} onClick={() => run('off', api.quartoPiscarDesligar)}>
          {running === 'off' ? 'Executando…' : 'Piscar e desligar'}
        </button>
      </div>
    </div>
  );
}
