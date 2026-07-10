import { useEffect, useRef, useState } from 'react';
import { talkApi } from '../lib/talkApi.js';
import '../pages/Sons.css';
import './TalkPanel.css';

// ms → "m:ss"
const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Interfone: abre o microfone do PC e a voz sai AO VIVO nas caixas escolhidas
// (ex.: Alexa conectada por Bluetooth). Caixas/microfone na aba Configuração.
export default function TalkPanel() {
  const [st, setSt] = useState({ talking: false, live: false, elapsedMs: 0, outputs: [], mic: '', error: null });
  const [outputs, setOutputs] = useState([]); // espelho local (sliders)
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // base do cronômetro vinda do servidor + relógio local para animar entre polls
  const [base, setBase] = useState({ elapsedMs: 0, live: false, at: 0 });
  const [, setTick] = useState(0);
  const dragging = useRef(false);

  const apply = (s) => {
    setSt(s);
    if (!dragging.current) setOutputs(s.outputs || []);
    setBase({ elapsedMs: s.elapsedMs || 0, live: !!s.live, at: Date.now() });
  };

  const refresh = () => talkApi.status().then(apply).catch((e) => setErr(e.message));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  // relógio local (4x/s) para o cronômetro andar suave entre os polls
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const elapsed = base.live ? base.elapsedMs + (Date.now() - base.at) : 0;

  const toggle = () => {
    setBusy(true);
    setErr(null);
    (st.talking ? talkApi.stop() : talkApi.start())
      .then(apply)
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  const dragVol = (name, v) =>
    setOutputs((prev) => prev.map((o) => (o.name === name ? { ...o, volume: v } : o)));
  const commitVol = (name, v) => {
    dragging.current = false;
    talkApi.volume(v, name).then(apply).catch((e) => setErr(e.message));
  };

  const names = outputs.map((o) => o.name).join(' + ');
  const btnClass = st.live ? 'live' : st.talking ? 'starting' : '';
  const btnLabel = st.live ? 'FECHAR MICROFONE' : st.talking ? 'CONECTANDO…' : 'ABRIR MICROFONE';

  return (
    <div className="talk-card">
      {(err || st.error) && <div className="sons-error" style={{ alignSelf: 'stretch' }}>Erro: {err || st.error}</div>}

      <button className={`talk-btn ${btnClass}`} onClick={toggle} disabled={busy}>
        <span className="talk-ico">{st.talking ? '⏹' : '🎙'}</span>
        {btnLabel}
      </button>

      {st.live ? (
        <div className="talk-live-row">
          <span className="talk-live-badge">Ao vivo</span>
          <span className="talk-timer">{fmt(elapsed)}</span>
        </div>
      ) : (
        <div className="talk-status">
          {outputs.length
            ? <>Sua voz vai sair em <strong>{names}</strong>.</>
            : <>Nenhuma caixa escolhida — selecione na aba <strong>Configuração</strong>.</>}
        </div>
      )}

      {outputs.length > 0 && (
        <div className="talk-vols sons-device">
          {outputs.map((o) => (
            <div key={o.name} className="sons-out on">
              <span className="sons-out-check">{o.name}</span>
              <div className="sons-out-vol">
                <input
                  type="range" min="0" max="100" step="1"
                  value={o.volume}
                  onPointerDown={() => { dragging.current = true; }}
                  onChange={(e) => dragVol(o.name, Number(e.target.value))}
                  onPointerUp={(e) => commitVol(o.name, Number(e.target.value))}
                />
                <span className="sons-out-pct">{o.volume}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
