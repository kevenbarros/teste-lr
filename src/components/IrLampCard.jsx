import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import {
  useIrLocal, BLASTER_QUARTO, IRLAMP_DEVICE, IRLAMP_DEVICE_NAME, IRLAMP_KEYS,
} from '../lib/useIrLocal.js';
import '../pages/PlanoB.css';
import './TvRemote.css';

// Lâmpada controlada por infravermelho (blaster do quarto): liga/desliga,
// brilho, cores (vermelho/branco/azul) e smooth. No modo "gravar", clicar num
// botão captura o código do controle físico da lâmpada.
export default function IrLampCard() {
  const { info, refresh } = useIrLocal(BLASTER_QUARTO);
  const [busy, setBusy] = useState(null);
  const [learnMode, setLearnMode] = useState(false);
  const [msg, setMsg] = useState(null);

  const configured = info?.configured;
  const connected = info?.connected;
  const learned = info?.devices?.[IRLAMP_DEVICE]?.keys || [];
  const missing = IRLAMP_KEYS.filter(k => !learned.includes(k.key));

  const press = async ({ key, label }) => {
    setBusy(key);
    setMsg(null);
    try {
      if (learnMode) {
        await irLocalApi.learn(IRLAMP_DEVICE, IRLAMP_DEVICE_NAME, key, BLASTER_QUARTO);
        setMsg(`Botão ${label} gravado!`);
      } else {
        await irLocalApi.send(IRLAMP_DEVICE, key, BLASTER_QUARTO);
      }
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const disabled = (key) => !configured || !!busy || (!learnMode && !learned.includes(key));
  const cls = (k) => [
    'action', k.className,
    learnMode ? 'recording' : '',
    learned.includes(k.key) ? 'has-code' : '',
  ].filter(Boolean).join(' ');
  const row = (keys) => keys.map((k) => (
    <button key={k.key} className={cls(k)} disabled={disabled(k.key)} onClick={() => press(k)}>
      {busy === k.key ? '···' : k.label}
    </button>
  ));
  const group = (names) => IRLAMP_KEYS.filter(k => names.includes(k.key));

  return (
    <section className="planob-card irlamp-card">
      <h2>Lâmpada (infravermelho)</h2>

      {configured ? (
        <div className={`planob-status ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● Conectado ao Smart IR do quarto' : '○ Procurando o Smart IR do quarto...'}
        </div>
      ) : (
        <div className="planob-error">
          Smart IR do quarto não configurado. Preencha o blaster <code>quarto</code> em <code>ir-local.json</code> e reinicie a API.
        </div>
      )}

      <div className="planob-row">{row(group(['on', 'off']))}</div>

      <div className="planob-mini-label">Brilho</div>
      <div className="planob-row led-extras">{row(group(['brilho+', 'brilho-']))}</div>

      <div className="planob-mini-label">Cores e efeito</div>
      <div className="planob-row led-extras">{row(group(['vermelho', 'branco', 'azul', 'smooth']))}</div>

      <div className="tvr-footer">
        <button
          className={`tvr-learn-toggle${learnMode ? ' active' : ''}`}
          disabled={!configured || !!busy}
          onClick={() => { setLearnMode(v => !v); setMsg(null); }}
        >
          {learnMode ? '● Gravando — clique num botão' : '⦿ Gravar botões'}
        </button>
        {learnMode && (
          <p className="planob-hint">
            Clique no botão que quer gravar, então <strong>aponte o controle da lâmpada para o Smart IR e
            pressione o botão real</strong> (30s).
          </p>
        )}
        {!learnMode && missing.length > 0 && (
          <p className="planob-hint">
            Falta gravar: {missing.map(k => k.label).join(', ')} — use <strong>⦿ Gravar botões</strong> ou o
            terminal (<code>node scripts/ir-learn.js {missing[0].key} quarto lampada-ir</code>).
          </p>
        )}
        {msg && <div className="planob-ok">{msg}</div>}
      </div>
    </section>
  );
}
