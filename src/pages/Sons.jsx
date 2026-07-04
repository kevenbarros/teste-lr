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
  const [status, setStatus] = useState({ playing: false, file: null, loop: false, volume: 40, device: '' });
  const [volume, setVolume] = useState(40);
  const [loop, setLoop] = useState(false);
  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState(null);
  const volumeInit = useRef(false);

  const applyStatus = (s) => {
    setStatus(s);
    if (!volumeInit.current && typeof s.volume === 'number') {
      setVolume(s.volume);
      volumeInit.current = true;
    }
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

  const play = async (file) => {
    setError(null);
    try {
      applyStatus(await soundApi.play(file, volume, loop));
    } catch (err) {
      setError(err.message);
    }
  };

  const stop = async () => {
    try {
      applyStatus(await soundApi.stop());
    } catch (err) {
      setError(err.message);
    }
  };

  // Solta o slider → aplica o volume ao vivo (não interrompe o que está tocando).
  const commitVolume = (v) => {
    soundApi.volume(v).then(applyStatus).catch((err) => setError(err.message));
  };

  // Troca a caixa de saída (vale pros sons daqui e pro som do "Iniciar piscar").
  const changeDevice = (d) => {
    soundApi.setDevice(d).then(applyStatus).catch((err) => setError(err.message));
  };

  return (
    <div className="sons-page">
      <h1>Sons na caixa</h1>
      <p className="sons-sub">Toca somente em <strong>{status.device || '...'}</strong>, sem interromper o fone.</p>

      {error && <div className="sons-error">Erro: {error}</div>}

      <div className={`sons-now ${status.playing ? 'on' : ''}`}>
        {status.playing
          ? <>▶ Tocando <strong>{pretty(status.file)}</strong>{status.loop && <span className="sons-badge">loop</span>}</>
          : '■ Parado'}
        <button className="sons-stop" onClick={stop} disabled={!status.playing}>Parar</button>
      </div>

      <div className="sons-controls sons-device-card">
        <label className="sons-device">
          Caixa de saída (vale também pro som do "Iniciar piscar"):
          <select value={status.device || ''} onChange={(e) => changeDevice(e.target.value)}>
            {status.device && !devices.includes(status.device) && (
              <option value={status.device}>{status.device} (salvo)</option>
            )}
            {devices.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <button className="sons-refresh" onClick={loadDevices} disabled={loadingDevices}>
          {loadingDevices ? 'Procurando...' : '↻ Atualizar lista'}
        </button>
      </div>

      <div className="sons-controls">
        <label className="sons-vol">
          Volume: <strong>{volume}%</strong>
          <input
            type="range" min="0" max="100" step="1"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={(e) => commitVolume(Number(e.target.value))}
            onKeyUp={(e) => commitVolume(Number(e.target.value))}
          />
        </label>
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
