import { useCallback, useEffect, useState } from 'react';
import { spotifyApi } from '../lib/spotifyApi.js';
import '../pages/Musica.css';

// Atalhos de playlist: um toque começa a tocar no destino salvo (as Alexas).
// A lista vem de spotify-config.json; a capa é buscada nas playlists da conta,
// e se essa busca falhar os botões continuam funcionando sem imagem.
export default function PlaylistsCard() {
  const [items, setItems] = useState([]);
  const [linked, setLinked] = useState(true);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const st = await spotifyApi.status();
      setLinked(st.linked);

      const art = {};
      if (st.linked) {
        try {
          for (const p of (await spotifyApi.playlists()).playlists) art[p.uri] = p.art;
        } catch { /* sem capa é só cosmético */ }
      }
      setItems((st.playlists || []).map((p) => ({ ...p, art: art[p.uri] || null })));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const play = async (p) => {
    setBusy(p.uri);
    setMsg(null);
    setError(null);
    try {
      await spotifyApi.playContext(p.uri);
      setMsg(`Tocando ${p.name}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="planob-card">
      <h2>🎧 Playlists</h2>
      <p className="planob-hint">Um toque troca o que está tocando nas Alexas.</p>

      {error && <div className="planob-error">{error}</div>}

      {!linked && <p className="planob-hint">Conecte a conta na aba Configuração para usar os atalhos.</p>}

      <div className="pl-grid">
        {items.map((p) => (
          <button
            key={p.uri}
            className={`pl-btn${busy === p.uri ? ' busy' : ''}`}
            disabled={!!busy || !linked}
            onClick={() => play(p)}
          >
            {p.art
              ? <img className="pl-art" src={p.art} alt="" />
              : <span className="pl-art pl-art-empty">♫</span>}
            <span className="pl-name">{busy === p.uri ? 'Tocando…' : p.name}</span>
          </button>
        ))}
      </div>

      {items.length === 0 && !error && (
        <p className="planob-hint">
          Nenhuma playlist em <code>spotify-config.json</code> — veja <code>spotify-config.example.json</code>.
        </p>
      )}

      {msg && <div className="planob-ok">{msg}</div>}
    </section>
  );
}
