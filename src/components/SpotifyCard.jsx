import { useCallback, useEffect, useState } from 'react';
import { spotifyApi } from '../lib/spotifyApi.js';
import '../pages/Musica.css';

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Player do Spotify. O destino é o device Connect salvo — se as duas Alexas
// estiverem num grupo multi-cômodos do app Alexa, elas aparecem como UM device
// só e tudo aqui toca nas duas ao mesmo tempo.
export default function SpotifyCard() {
  const [cfg, setCfg] = useState(null);
  const [now, setNow] = useState(null);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [vol, setVol] = useState(null); // slider "solto" enquanto arrasta

  const refresh = useCallback(async () => {
    try {
      const st = await spotifyApi.status();
      setCfg(st);
      if (!st.linked) return setNow(null);
      const n = await spotifyApi.now();
      setNow(n);
      setError(null);
      // Só semeia o slider na primeira leitura, pra não brigar com o arrasto.
      setVol((v) => (v === null && n.volume != null ? n.volume : v));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const loadDevices = useCallback(async () => {
    setBusy('devices');
    try {
      setDevices((await spotifyApi.devices()).devices);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const act = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (!cfg) return <section className="planob-card"><h2>🎵 Spotify</h2><p className="planob-hint">Carregando…</p></section>;

  if (!cfg.configured) {
    return (
      <section className="planob-card">
        <h2>🎵 Spotify</h2>
        <p className="planob-hint">
          Falta cadastrar o Client ID e o Client Secret do seu app do Spotify na aba <b>Configuração</b>.
        </p>
      </section>
    );
  }

  if (!cfg.linked) {
    return (
      <section className="planob-card">
        <h2>🎵 Spotify</h2>
        <p className="planob-hint">Conta ainda não conectada.</p>
        <div className="planob-row">
          <a className="spot-link-btn" href={spotifyApi.loginUrl()}>Conectar com Spotify</a>
        </div>
      </section>
    );
  }

  const playing = now?.playing;
  const onTarget = now?.onTarget;

  return (
    <section className="planob-card spot-card">
      <h2>
        🎵 Spotify
        {cfg.deviceName && <span className="spot-target"> → {cfg.deviceName}</span>}
      </h2>

      {error && <div className="planob-error">{error}</div>}

      <div className="spot-now">
        {now?.art
          ? <img className="spot-art" src={now.art} alt="" />
          : <div className="spot-art spot-art-empty">♫</div>}
        <div className="spot-meta">
          <div className="spot-track">{now?.track || 'Nada tocando'}</div>
          <div className="spot-artist">{now?.artist || '—'}</div>
          {now?.active && (
            <div className="spot-sub">
              {mmss(now.progressMs)} / {mmss(now.durationMs)}
              {now.device && <> · tocando em <b>{now.device}</b></>}
            </div>
          )}
          {now?.active && cfg.deviceId && !onTarget && (
            <button
              className="spot-mini"
              disabled={busy === 'transfer'}
              onClick={() => act('transfer', () => spotifyApi.transfer(true))}
            >
              Jogar para {cfg.deviceName || 'as Alexas'}
            </button>
          )}
        </div>
      </div>

      <div className="spot-controls">
        <button disabled={!!busy} onClick={() => act('prev', spotifyApi.previous)} title="Anterior">⏮</button>
        <button
          className="spot-play"
          disabled={!!busy}
          onClick={() => act('toggle', spotifyApi.toggle)}
          title={playing ? 'Pausar' : 'Tocar'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button disabled={!!busy} onClick={() => act('next', spotifyApi.next)} title="Próxima">⏭</button>
      </div>

      <div className="planob-slider">
        <label>Volume {vol ?? '—'}%</label>
        <input
          type="range"
          min="0"
          max="100"
          value={vol ?? 0}
          onChange={(e) => setVol(Number(e.target.value))}
          onMouseUp={(e) => act('volume', () => spotifyApi.volume(Number(e.target.value)))}
          onTouchEnd={(e) => act('volume', () => spotifyApi.volume(Number(e.target.value)))}
        />
      </div>

      {cfg.playlists?.length > 0 && (
        <>
          <div className="planob-mini-label">Playlists</div>
          <div className="planob-row">
            {cfg.playlists.map((p) => (
              <button
                key={p.uri}
                className="action blue"
                disabled={!!busy}
                onClick={() => act(p.uri, () => spotifyApi.playContext(p.uri))}
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="planob-mini-label">Onde tocar</div>
      <div className="spot-devices">
        <button className="spot-mini" disabled={busy === 'devices'} onClick={loadDevices}>
          {busy === 'devices' ? 'Procurando…' : 'Procurar caixas'}
        </button>
        {devices.map((d) => (
          <button
            key={d.id}
            className={`spot-device${d.target ? ' target' : ''}${d.active ? ' active' : ''}`}
            disabled={!!busy}
            onClick={() => act(d.id, async () => {
              await spotifyApi.setDevice(d.id, d.name);
              await spotifyApi.transfer(false);
            })}
          >
            <span className="spot-device-name">{d.name}</span>
            <span className="spot-device-type">{d.type}{d.active ? ' · tocando' : ''}{d.target ? ' · padrão' : ''}</span>
          </button>
        ))}
        {devices.length === 0 && (
          <p className="planob-hint">
            Se o grupo das Alexas não aparecer, peça “Alexa, tocar Spotify” uma vez — devices ociosos somem da lista.
          </p>
        )}
      </div>
    </section>
  );
}
