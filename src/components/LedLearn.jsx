import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import { IR_DEVICE, IR_DEVICE_NAME, LED_KEYS } from '../lib/useIrLocal.js';
import IrStatus from './IrStatus.jsx';
import '../pages/PlanoB.css';

// Aprender os botões (ON/OFF) do controle físico da fita via Smart IR.
export default function LedLearn({ info, refresh }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const configured = info?.configured;
  const connected = info?.connected;
  const learned = info?.devices?.[IR_DEVICE]?.keys || [];
  const hasOn = learned.includes('on');
  const hasOff = learned.includes('off');

  const learn = async (key) => {
    setBusy(`learn-${key}`);
    setMsg(null);
    try {
      await irLocalApi.learn(IR_DEVICE, IR_DEVICE_NAME, key);
      setMsg(`Botão "${key.toUpperCase()}" aprendido!`);
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="planob-card">
      <h2>Fita de LED — aprender botões</h2>
      <IrStatus info={info} refresh={refresh} blaster="porao" label="Smart IR do porão" />
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

      <div className="planob-mini-label">Cores, modo e brilho</div>
      <div className="planob-row led-extras">
        {LED_KEYS.map(({ key, label }) => (
          <button key={key} className="learn" disabled={!configured || !!busy} onClick={() => learn(key)}>
            {busy === `learn-${key}` ? 'Aguardando...' : `${label} ${learned.includes(key) ? '✓' : ''}`}
          </button>
        ))}
      </div>

      {msg && <div className="planob-ok">{msg}</div>}
    </section>
  );
}
