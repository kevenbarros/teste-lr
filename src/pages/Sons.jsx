import { useEffect, useRef, useState } from 'react';
import { soundApi } from '../lib/soundApi.js';
import './Sons.css';

// Nome amigável a partir do arquivo (risada.mp3 → "Risada").
const pretty = (file) => {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
};

export default function Sons() {
  const [sounds, setSounds] = useState([]);
  const [status, setStatus] = useState({ playing: false, file: null, loop: false, outputs: [] });
  const [outputs, setOutputs] = useState([]); // espelho local (sliders arrastando)
  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [loop, setLoop] = useState(false);
  const [error, setError] = useState(null);
  const dragging = useRef(false); // não deixa o polling sobrescrever slider em uso

  const applyStatus = (s) => {
    setStatus(s);
    if (!dragging.current) setOutputs(s.outputs || []);
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

  const loadDevices = async () => {
    setLoadingDevices(true);
    try {
      const data = await soundApi.devices();
      setDevices(data.devices || []);
      applyStatus(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    refresh();
    loadDevices();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const play = (file) => {
    setError(null);
    soundApi.play(file, loop).then(applyStatus).catch((err) => setError(err.message));
  };

  const stopAll = () => {
    soundApi.stop().then(applyStatus).catch((err) => setError(err.message));
  };

  // Liga/desliga uma caixa (mín. 1 selecionada). Vale pros sons daqui e pro piscar.
  const toggleOutput = (name) => {
    setError(null);
    const has = outputs.some((o) => o.name === name);
    if (has && outputs.length === 1) {
      setError('pelo menos uma caixa deve ficar selecionada');
      return;
    }
    const next = has
      ? outputs.filter((o) => o.name !== name)
      : [...outputs, { name, volume: 40 }];
    soundApi.setOutputs(next).then(applyStatus).catch((err) => setError(err.message));
  };

  // Slider individual: arrasta → estado local; solta → volume ao vivo só daquela caixa.
  const dragVolume = (name, v) => {
    setOutputs((prev) => prev.map((o) => (o.name === name ? { ...o, volume: v } : o)));
  };
  const commitVolume = (name, v) => {
    dragging.current = false;
    soundApi.volume(v, name).then(applyStatus).catch((err) => setError(err.message));
  };

  // Caixas salvas que não aparecem na lista atual (ex.: desligadas) ainda são exibidas.
  const offline = outputs.filter((o) => !devices.includes(o.name)).map((o) => o.name);
  const allNames = [...devices, ...offline];

  return (
    <div className="sons-page">
      <h1>Sons na caixa</h1>
      <p className="sons-sub">
        Toca somente em{' '}
        <strong>{outputs.map((o) => o.name).join(' + ') || '...'}</strong>, sem interromper o fone.
      </p>

      {error && <div className="sons-error">Erro: {error}</div>}

      <div className={`sons-now ${status.playing ? 'on' : ''}`}>
        {status.playing
          ? <>▶ Tocando <strong>{pretty(status.file)}</strong>{status.loop && <span className="sons-badge">loop</span>}</>
          : '■ Parado'}
        <button className="sons-stop" onClick={stopAll} disabled={!status.playing}>Parar</button>
      </div>

      <div className="sons-controls sons-device-card">
        <div className="sons-device">
          <span className="sons-device-title">
            Caixas de saída — marque 1 ou mais (vale também pro som do "Iniciar piscar"):
          </span>
          {allNames.map((name) => {
            const out = outputs.find((o) => o.name === name);
            const isOffline = offline.includes(name);
            return (
              <div key={name} className={`sons-out ${out ? 'on' : ''}`}>
                <label className="sons-out-check">
                  <input type="checkbox" checked={!!out} onChange={() => toggleOutput(name)} />
                  {name}{isOffline && <span className="sons-out-offline"> (não encontrada)</span>}
                </label>
                {out && (
                  <div className="sons-out-vol">
                    <input
                      type="range" min="0" max="100" step="1"
                      value={out.volume}
                      onPointerDown={() => { dragging.current = true; }}
                      onChange={(e) => dragVolume(name, Number(e.target.value))}
                      onPointerUp={(e) => commitVolume(name, Number(e.target.value))}
                    />
                    <span className="sons-out-pct">{out.volume}%</span>
                  </div>
                )}
              </div>
            );
          })}
          {allNames.length === 0 && <p className="sons-hint">Nenhuma saída de áudio encontrada.</p>}
        </div>
        <button className="sons-refresh" onClick={loadDevices} disabled={loadingDevices}>
          {loadingDevices ? 'Procurando...' : '↻ Atualizar lista'}
        </button>
      </div>

      <div className="sons-controls">
        <label className={`sons-loop ${loop ? 'on' : ''}`}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Repetir (loop)
        </label>
      </div>

      <div className="sons-grid">
        {sounds.map((file) => {
          const active = status.playing && status.file === file;
          return (
            <button
              key={file}
              className={`sons-btn ${active ? 'active' : ''}`}
              onClick={() => play(file)}
            >
              <span className="sons-btn-icon">{active ? '▶' : '♪'}</span>
              <span className="sons-btn-name">{pretty(file)}</span>
              <span className="sons-btn-file">{file}</span>
            </button>
          );
        })}
        {sounds.length === 0 && !error && <p className="sons-hint">Nenhum som em <code>sounds/</code>.</p>}
      </div>
    </div>
  );
}
