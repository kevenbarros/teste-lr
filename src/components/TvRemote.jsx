import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import { useIrLocal, BLASTER_QUARTO, TV_DEVICE, TV_DEVICE_NAME, TV_KEYS } from '../lib/useIrLocal.js';
import '../pages/PlanoB.css';
import './TvRemote.css';

// Balancim vertical (+ em cima, − embaixo) com rótulo no meio: VOL e CH.
function Rocker({ name, upKey, downKey, cls, disabled, label, find, press }) {
  return (
    <div className="tvr-rocker">
      <span className="tvr-rocker-label">{name}</span>
      <button
        className={cls(upKey, 'tvr-vol')}
        disabled={disabled(upKey)}
        title={find(upKey).name}
        onClick={() => press(find(upKey))}
      >
        {label(find(upKey))}
      </button>
      <button
        className={cls(downKey, 'tvr-vol')}
        disabled={disabled(downKey)}
        title={find(downKey).name}
        onClick={() => press(find(downKey))}
      >
        {label(find(downKey))}
      </button>
    </div>
  );
}

// Controle remoto da TV (aba Quarto), com layout de controle físico:
// power (liga/desliga — mesmo código), balancins de volume e canal, e DVD.
// No modo "gravar", clicar num botão captura o código do controle real.
export default function TvRemote() {
  const { info, refresh } = useIrLocal(BLASTER_QUARTO);
  const [busy, setBusy] = useState(null); // key em uso (send ou learn)
  const [learnMode, setLearnMode] = useState(false);
  const [msg, setMsg] = useState(null);

  const configured = info?.configured;
  const connected = info?.connected;
  const learned = info?.devices?.[TV_DEVICE]?.keys || [];
  const missing = TV_KEYS.filter(k => !learned.includes(k.key));

  const press = async ({ key, name }) => {
    setBusy(key);
    setMsg(null);
    try {
      if (learnMode) {
        await irLocalApi.learn(TV_DEVICE, TV_DEVICE_NAME, key, BLASTER_QUARTO);
        setMsg(`Botão ${name} gravado!`);
      } else {
        await irLocalApi.send(TV_DEVICE, key, BLASTER_QUARTO);
      }
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  // No modo gravar todo botão fica clicável; fora dele, só os já gravados.
  const disabled = (key) => !configured || !!busy || (!learnMode && !learned.includes(key));
  const cls = (key, base) => [
    base,
    learnMode ? 'recording' : '',
    learned.includes(key) ? 'has-code' : '',
    busy === key ? 'busy' : '',
  ].filter(Boolean).join(' ');
  const label = (k) => (busy === k.key ? (learnMode ? '···' : k.label) : k.label);
  const find = (key) => TV_KEYS.find(k => k.key === key);

  return (
    <section className="planob-card tvremote-card">
      <h2>TV do quarto</h2>

      {configured ? (
        <div className={`planob-status ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● Conectado ao Smart IR do quarto' : '○ Procurando o Smart IR do quarto...'}
        </div>
      ) : (
        <div className="planob-error">
          Smart IR do quarto não configurado. Preencha o blaster <code>quarto</code> em <code>ir-local.json</code> e reinicie a API.
        </div>
      )}

      <div className="tvremote">
        <button
          className={cls('power', 'tvr-power')}
          disabled={disabled('power')}
          title="Power (liga/desliga)"
          onClick={() => press(find('power'))}
        >
          {busy === 'power' ? '···' : '⏻'}
        </button>

        <div className="tvr-row">
          <Rocker name="VOL" upKey="vol+" downKey="vol-" {...{ cls, disabled, label, find, press }} />

          <button
            className={cls('dvd', 'tvr-dvd')}
            disabled={disabled('dvd')}
            title="DVD"
            onClick={() => press(find('dvd'))}
          >
            {label(find('dvd'))}
          </button>

          <Rocker name="CH" upKey="canal+" downKey="canal-" {...{ cls, disabled, label, find, press }} />
        </div>
      </div>

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
            Clique no botão que quer gravar, então <strong>aponte o controle da TV para o Smart IR e
            pressione o botão real</strong> (30s).
          </p>
        )}
        {!learnMode && missing.length > 0 && (
          <p className="planob-hint">
            Falta gravar: {missing.map(k => k.name).join(', ')} — use <strong>⦿ Gravar botões</strong> ou o
            terminal (<code>node scripts/ir-learn.js {missing[0].key} quarto tv</code>).
          </p>
        )}
        {msg && <div className="planob-ok">{msg}</div>}
      </div>
    </section>
  );
}
