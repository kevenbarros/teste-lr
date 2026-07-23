import { useCallback, useEffect, useState } from 'react';
import { spotifyApi } from '../lib/spotifyApi.js';
import '../pages/PlanoB.css';
import '../pages/Musica.css';

// Cadastro do app do Spotify (Client ID/Secret do developer.spotify.com) e o
// login OAuth. Feito uma vez só — depois o refresh_token fica em
// spotify-config.json e o servidor renova o acesso sozinho.
export default function SpotifySetup() {
  const [cfg, setCfg] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const st = await spotifyApi.status();
      setCfg(st);
      setClientId(st.clientId || '');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const salvar = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      // Secret em branco = manter o que já está salvo (não mostramos o atual).
      const patch = { clientId };
      if (clientSecret) patch.clientSecret = clientSecret;
      setCfg(await spotifyApi.saveConfig(patch));
      setClientSecret('');
      setMsg('Credenciais salvas.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const desconectar = async () => {
    setBusy(true);
    try {
      setCfg(await spotifyApi.logout());
      setMsg('Conta desconectada.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="planob-card">
      <h2>🎵 Spotify</h2>
      <p className="planob-hint">
        Crie um app em <code>developer.spotify.com/dashboard</code> e cadastre o Redirect URI{' '}
        <code>{cfg?.redirectUri || 'http://127.0.0.1:5858/api/spotify/callback'}</code> — precisa ser
        idêntico. Exige conta Premium para controlar o playback.
      </p>

      {error && <div className="planob-error">{error}</div>}

      <div className="spot-devices">
        <label className="planob-mini-label" htmlFor="spot-id">Client ID</label>
        <input
          id="spot-id"
          className="spot-input"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="ex.: 4f9c0e1a2b3c4d5e6f..."
        />

        <label className="planob-mini-label" htmlFor="spot-secret">Client Secret</label>
        <input
          id="spot-secret"
          className="spot-input"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={cfg?.hasSecret ? '•••••••• (salvo — deixe vazio para manter)' : 'cole o secret'}
        />
      </div>

      <div className="planob-row botoesdistantes">
        <button className="learn" disabled={busy} onClick={salvar}>
          {busy ? 'Salvando…' : 'Salvar credenciais'}
        </button>
        {cfg?.configured && (
          <a className="spot-link-btn" href={spotifyApi.loginUrl()}>
            {cfg.linked ? 'Reconectar conta' : 'Conectar com Spotify'}
          </a>
        )}
        {cfg?.linked && (
          <button className="action stop" disabled={busy} onClick={desconectar}>Desconectar</button>
        )}
      </div>

      <div className={`planob-status ${cfg?.linked ? 'ok' : 'bad'}`}>
        {cfg?.linked
          ? `Conectado${cfg.deviceName ? ` · tocando em "${cfg.deviceName}"` : ' · escolha o destino na aba Música'}`
          : 'Conta não conectada'}
      </div>

      {msg && <div className="planob-ok">{msg}</div>}
    </section>
  );
}
