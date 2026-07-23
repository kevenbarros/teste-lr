import { useState } from 'react';
import { lampsApi as api } from '../lib/lampsApi.js';
import { scenesApi } from '../lib/scenesApi.js';
import '../pages/Lamps.css';

// Automação do quarto: pisca entrada+saída por 5s e termina no estado escolhido.
// "Avançar de sala" é a cena completa (piscar → TV → playlist), definida em
// scenes.json e executada no servidor.
export default function QuartoAutomation() {
  const [running, setRunning] = useState(null);
  const [msg, setMsg] = useState(null);

  const run = async (label, fn) => {
    setRunning(label);
    setMsg(null);
    try {
      await fn();
      setTimeout(() => setRunning(null), 5200);
    } catch (err) {
      alert(err.message);
      setRunning(null);
    }
  };

  // A cena leva ~5s (playlist → TV → espera). Ela volta no instante em que o
  // piscar COMEÇA, que ainda roda uns 5s sozinho — daí a mensagem no futuro.
  const runScene = async () => {
    setRunning('sala');
    setMsg(null);
    try {
      const r = await scenesApi.run('avancar-de-sala');
      const falhas = r.results.filter((s) => !s.ok);
      setMsg(falhas.length
        ? `Falhou: ${falhas.map((f) => `${f.label} (${f.error})`).join(' · ')}`
        : 'Playlist trocada e TV ligada — as luzes vão piscar e apagar.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="lamp-card automation">
      <div className="automation-info">
        <h2>⚡ Automação <span className="automation-tag">entrada + saída</span></h2>
        <p>Pisca por 5s (entrada 100ms / saída 200ms) e termina no estado escolhido.</p>
        {msg && <p className={`automation-msg${msg.startsWith('Falhou') ? ' bad' : ''}`}>{msg}</p>}
      </div>
      <div className="automation-actions">
        <button className="on" disabled={!!running} onClick={() => run('on', api.quartoPiscar)}>
          {running === 'on' ? 'Executando…' : 'Piscar e acender'}
        </button>
        <button className="off" disabled={!!running} onClick={() => run('off', api.quartoPiscarDesligar)}>
          {running === 'off' ? 'Executando…' : 'Piscar e desligar'}
        </button>
        <button
          className="scene"
          disabled={!!running}
          onClick={runScene}
          title="Troca para The Faceless Ones, liga a TV e, 5s depois, pisca e desliga as luzes"
        >
          {running === 'sala' ? 'Avançando…' : '🚪 Avançar de sala'}
        </button>
      </div>
    </div>
  );
}
