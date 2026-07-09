import { useEffect, useRef, useState } from 'react';
import { soundApi } from '../lib/soundApi.js';
import '../pages/Sons.css';

// Nome amigável a partir do arquivo (risada.mp3 → "Risada").
const pretty = (file) => {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
};

// ms → "m:ss"
const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Painel para tocar sons na(s) caixa(s), com volume por som e volume por caixa.
// As caixas de saída em si são escolhidas na aba Configuração.
export default function SoundBoard() {
  const [sounds, setSounds] = useState([]);
  const [status, setStatus] = useState({ playing: false, file: null, loop: false, outputs: [], soundVolumes: {}, alertPlaying: false });
  const [outputs, setOutputs] = useState([]);        // espelho local (sliders de caixa)
  const [soundVols, setSoundVols] = useState({});    // espelho local (sliders de som)
  const [loop, setLoop] = useState(false);
  const [error, setError] = useState(null);
  // base de progresso vinda do servidor + relógio local p/ animar entre polls
  const [posBase, setPosBase] = useState({ positionMs: 0, durationMs: 0, loop: false, on: false, at: 0 });
  const [, setTick] = useState(0);
  const draggingBox = useRef(false);
  const draggingSound = useRef(false);

  const applyStatus = (s) => {
    setStatus(s);
    if (!draggingBox.current) setOutputs(s.outputs || []);
    if (!draggingSound.current) setSoundVols(s.soundVolumes || {});
    setPosBase({
      positionMs: s.positionMs || 0,
      durationMs: s.durationMs || 0,
      loop: !!s.loop,
      on: !!(s.playing || s.alertPlaying),
      at: Date.now(),
    });
  };

  const refresh = async () => {
    try {
      const data = await soundApi.list();
      setSounds(data.sounds || []);
      applyStatus(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  // relógio local (4x/s) para a barra de progresso andar suave entre os polls
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  // posição interpolada agora
  let dispMs = posBase.positionMs;
  if (posBase.on && posBase.durationMs > 0) {
    const dt = Date.now() - posBase.at;
    dispMs = posBase.loop
      ? (posBase.positionMs + dt) % posBase.durationMs
      : Math.min(posBase.positionMs + dt, posBase.durationMs);
  }
  const showProgress = posBase.on && posBase.durationMs > 0;
  const pct = showProgress ? Math.min(100, (dispMs / posBase.durationMs) * 100) : 0;

  const play = (file) => {
    setError(null);
    soundApi.play(file, loop).then(applyStatus).catch((err) => setError(err.message));
  };
  const stopAll = () => soundApi.stop().then(applyStatus).catch((err) => setError(err.message));

  // Volume por caixa (endpoint), ao vivo.
  const dragBox = (name, v) =>
    setOutputs((prev) => prev.map((o) => (o.name === name ? { ...o, volume: v } : o)));
  const commitBox = (name, v) => {
    draggingBox.current = false;
    soundApi.volume(v, name).then(applyStatus).catch((err) => setError(err.message));
  };

  // Volume por som (ganho do stream); vale na próxima vez que o som tocar.
  const dragSound = (file, v) => setSoundVols((prev) => ({ ...prev, [file]: v }));
  const commitSound = (file, v) => {
    draggingSound.current = false;
    soundApi.soundVolume(file, v).then(applyStatus).catch((err) => setError(err.message));
  };

  const soundVol = (file) => (soundVols[file] == null ? 100 : soundVols[file]);
  const busy = status.playing || status.alertPlaying;

  return (
    <div className="sons-board">
      <h2 className="sons-h2">Sons na caixa</h2>
      <p className="sons-sub">
        Toca em <strong>{outputs.map((o) => o.name).join(' + ') || 'nenhuma caixa'}</strong>.
        Escolha as caixas na aba <strong>Configuração</strong>.
      </p>

      {error && <div className="sons-error">Erro: {error}</div>}

      <div className={`sons-now ${busy ? 'on' : ''}`}>
        {status.playing
          ? <>▶ Tocando <strong>{pretty(status.file)}</strong>{status.loop && <span className="sons-badge">loop</span>}</>
          : status.alertPlaying
            ? <>▶ Tocando <strong>{pretty(status.alertSound || '')}</strong><span className="sons-badge">piscar</span></>
            : '■ Parado'}
        <button className="sons-stop" onClick={stopAll} disabled={!busy}>Parar</button>
      </div>

      {showProgress && (
        <div className="sons-progress">
          <div className="sons-progress-bar">
            <div className="sons-progress-fill" style={{ width: `${pct}%` }} />
            <div className="sons-progress-knob" style={{ left: `${pct}%` }} />
          </div>
          <div className="sons-progress-time">
            <span>{fmt(dispMs)}</span>
            <span>{Math.round(pct)}%</span>
            <span>-{fmt(Math.max(0, posBase.durationMs - dispMs))}</span>
          </div>
        </div>
      )}

      <div className="sons-controls">
        <label className={`sons-loop ${loop ? 'on' : ''}`}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Repetir (loop)
        </label>
      </div>

      {outputs.length > 0 && (
        <div className="sons-controls sons-device-card">
          <div className="sons-device">
            <span className="sons-device-title">Volume por caixa:</span>
            {outputs.map((o) => (
              <div key={o.name} className="sons-out on">
                <span className="sons-out-check">{o.name}</span>
                <div className="sons-out-vol">
                  <input
                    type="range" min="0" max="100" step="1"
                    value={o.volume}
                    onPointerDown={() => { draggingBox.current = true; }}
                    onChange={(e) => dragBox(o.name, Number(e.target.value))}
                    onPointerUp={(e) => commitBox(o.name, Number(e.target.value))}
                  />
                  <span className="sons-out-pct">{o.volume}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sons-grid">
        {sounds.map((file) => {
          const active = (status.playing && status.file === file)
            || (status.alertPlaying && status.alertSound === file);
          return (
            <div key={file} className={`sons-card ${active ? 'active' : ''}`}>
              <button className="sons-play" onClick={() => play(file)}>
                <span className="sons-btn-icon">{active ? '▶' : '♪'}</span>
                <span className="sons-btn-name">{pretty(file)}</span>
                <span className="sons-btn-file">{file}</span>
              </button>
              <div className="sons-svol">
                <input
                  type="range" min="0" max="100" step="1"
                  value={soundVol(file)}
                  onPointerDown={() => { draggingSound.current = true; }}
                  onChange={(e) => dragSound(file, Number(e.target.value))}
                  onPointerUp={(e) => commitSound(file, Number(e.target.value))}
                  title="Volume deste som"
                />
                <span className="sons-out-pct">{soundVol(file)}%</span>
              </div>
            </div>
          );
        })}
        {sounds.length === 0 && !error && <p className="sons-hint">Nenhum som em <code>sounds/</code>.</p>}
      </div>
    </div>
  );
}
