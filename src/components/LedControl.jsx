import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import { IR_DEVICE, LED_KEYS } from '../lib/useIrLocal.js';
import '../pages/PlanoB.css';

// Controle liga/desliga da fita de LED (Smart IR local). Recebe o status
// compartilhado (info) e o refresh do hook useIrLocal.
export default function LedControl({ info, refresh }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const configured = info?.configured;
  const connected = info?.connected;
  const learned = info?.devices?.[IR_DEVICE]?.keys || [];
  const hasOn = learned.includes('on');
  const hasOff = learned.includes('off');

  const run = async (tag, fn, okMsg) => {
    setBusy(tag);
    setMsg(null);
    try {
      await fn();
      setMsg(okMsg);
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="planob-card">
      <h2>Fita de LED — controlar</h2>
      {configured && (
        <div className={`planob-status ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● Conectado ao Smart IR na rede' : '○ Procurando o Smart IR na rede...'}
        </div>
      )}
      {info && !configured && (
        <div className="planob-error">
          Falta configurar a <strong>local key</strong> do Smart IR (<code>ir-local.json</code>).
        </div>
      )}
      <div className="planob-row">
        <button className="action on" disabled={!hasOn || !!busy}
          onClick={() => run('on', () => irLocalApi.send(IR_DEVICE, 'on'), 'Comando LIGAR enviado')}>
          {busy === 'on' ? 'Enviando...' : 'Ligar'}
        </button>
        <button className="action off" disabled={!hasOff || !!busy}
          onClick={() => run('off', () => irLocalApi.send(IR_DEVICE, 'off'), 'Comando DESLIGAR enviado')}>
          {busy === 'off' ? 'Enviando...' : 'Desligar'}
        </button>
      </div>
      {(!hasOn || !hasOff) && (
        <p className="planob-hint">Aprenda os botões "on" e "off" na aba <strong>Configuração</strong> para habilitar.</p>
      )}

      <div className="planob-mini-label">Cores e modo</div>
      <div className="planob-row led-extras">
        {LED_KEYS.filter(k => k.className !== 'bright').map(({ key, label, className }) => (
          <button key={key} className={`action ${className}`} disabled={!learned.includes(key) || !!busy}
            onClick={() => run(key, () => irLocalApi.send(IR_DEVICE, key), `Comando ${label} enviado`)}>
            {busy === key ? '···' : label}
          </button>
        ))}
      </div>

      <div className="planob-mini-label">Brilho</div>
      <div className="planob-row led-extras">
        {LED_KEYS.filter(k => k.className === 'bright').map(({ key, label, className }) => (
          <button key={key} className={`action ${className}`} disabled={!learned.includes(key) || !!busy}
            onClick={() => run(key, () => irLocalApi.send(IR_DEVICE, key), `Comando ${label} enviado`)}>
            {busy === key ? '···' : label}
          </button>
        ))}
      </div>

      {LED_KEYS.some(k => !learned.includes(k.key)) && (
        <p className="planob-hint">
          Botões apagados ainda não foram aprendidos — grave-os na aba <strong>Configuração</strong>.
        </p>
      )}
      {msg && <div className="planob-ok">{msg}</div>}
    </section>
  );
}
