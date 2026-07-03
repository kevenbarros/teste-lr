import { useEffect, useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import './PlanoB.css';

const DEVICE = 'fita-led';
const DEVICE_NAME = 'Fita de LED porão';

export default function PlanoB() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const refresh = async () => {
    try {
      setInfo(await irLocalApi.status());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const [intervalMs, setIntervalMs] = useState(800);

  const learned = info?.devices?.[DEVICE]?.keys || [];
  const hasOn = learned.includes('on');
  const hasOff = learned.includes('off');
  const configured = info?.configured;
  const connected = info?.connected;
  const blinking = info?.effect === 'blink';

  const run = async (tag, fn, okMsg) => {
    setBusy(tag);
    setMsg(null);
    try {
      await fn();
      setMsg(okMsg);
      await refresh();
    } catch (err) {
      setMsg(null);
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const learn = (key) =>
    run(`learn-${key}`, () => irLocalApi.learn(DEVICE, DEVICE_NAME, key), `Botão "${key.toUpperCase()}" aprendido!`);

  return (
    <div className="planob-page">
      <h1>Plano B — Smart IR Local</h1>
      <p className="planob-sub">Controle direto na rede Wi-Fi, sem depender da nuvem Tuya.</p>

      {error && <div className="planob-error">Erro: {error}</div>}

      {info && !configured && (
        <div className="planob-error">
          Falta configurar. Crie <code>ir-local.json</code> (veja <code>ir-local.example.json</code>) com a
          <strong> local key</strong> do Smart IR e reinicie a API.
        </div>
      )}

      {configured && (
        <div className={`planob-status ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● Conectado ao Smart IR na rede' : '○ Procurando o Smart IR na rede...'}
        </div>
      )}

      <section className="planob-card">
        <h2>1. Aprender os botões</h2>
        <p className="planob-hint">
          Clique em aprender, então <strong>aponte o controle físico da fita para o Smart IR e pressione o
          botão</strong>. Você tem 30s.
        </p>
        <div className="planob-row">
          <button className="learn" disabled={!configured || !!busy} onClick={() => learn('on')}>
            {busy === 'learn-on' ? 'Aguardando botão...' : `Aprender LIGAR ${hasOn ? '✓' : ''}`}
          </button>
          <button className="learn" disabled={!configured || !!busy} onClick={() => learn('off')}>
            {busy === 'learn-off' ? 'Aguardando botão...' : `Aprender DESLIGAR ${hasOff ? '✓' : ''}`}
          </button>
        </div>
      </section>

      <section className="planob-card">
        <h2>2. Controlar</h2>
        <div className="planob-row">
          <button className="action on" disabled={!hasOn || !!busy}
            onClick={() => run('on', () => irLocalApi.send(DEVICE, 'on'), 'Comando LIGAR enviado')}>
            {busy === 'on' ? 'Enviando...' : 'Ligar'}
          </button>
          <button className="action off" disabled={!hasOff || !!busy}
            onClick={() => run('off', () => irLocalApi.send(DEVICE, 'off'), 'Comando DESLIGAR enviado')}>
            {busy === 'off' ? 'Enviando...' : 'Desligar'}
          </button>
        </div>
        {(!hasOn || !hasOff) && <p className="planob-hint">Aprenda os botões na etapa 1 para habilitar o controle.</p>}
        {msg && <div className="planob-ok">{msg}</div>}
      </section>

      <section className="planob-card">
        <h2>3. Piscar {blinking && <span className="planob-blinking">● piscando</span>}</h2>
        <p className="planob-hint">Alterna LIGAR/DESLIGAR continuamente. Ajuste a velocidade abaixo.</p>

        <div className="planob-slider">
          <label>Intervalo: <strong>{intervalMs} ms</strong> ({(1000 / intervalMs).toFixed(1)}x por segundo)</label>
          <input
            type="range" min="300" max="3000" step="50"
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
            onPointerUp={(e) => { if (blinking) irLocalApi.blink(DEVICE, Number(e.target.value)).catch(() => {}); }}
          />
          <div className="planob-slider-ends"><span>rápido (300ms)</span><span>lento (3s)</span></div>
        </div>

        <div className="planob-row">
          <button className="action blink" disabled={!hasOn || !hasOff || !!busy}
            onClick={() => run('blink', () => irLocalApi.blink(DEVICE, intervalMs), `Piscando a cada ${intervalMs}ms`)}>
            {blinking ? 'Atualizar velocidade' : 'Iniciar piscar'}
          </button>
          <button className="action stop" disabled={!blinking && !busy}
            onClick={() => run('stop', () => irLocalApi.stop(), 'Piscar parado')}>
            Parar
          </button>
        </div>
        {(!hasOn || !hasOff) && <p className="planob-hint">Precisa dos botões "on" e "off" aprendidos.</p>}
      </section>
    </div>
  );
}
