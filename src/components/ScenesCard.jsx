import { useCallback, useEffect, useState } from 'react';
import { scenesApi } from '../lib/scenesApi.js';
import '../pages/Musica.css';

// Cenas: um botão dispara vários comandos em sequência (música + luz + TV).
// Como um passo pode falhar sozinho (TV sem código gravado, lâmpada offline),
// mostramos o resultado passo a passo em vez de um "erro" genérico.
export default function ScenesCard() {
  const [scenes, setScenes] = useState([]);
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setScenes((await scenesApi.list()).scenes);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (scene) => {
    setRunning(scene.id);
    setResult(null);
    setError(null);
    try {
      setResult(await scenesApi.run(scene.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <section className="planob-card">
      <h2>⚡ Cenas</h2>
      <p className="planob-hint">Um toque: troca a música, mexe nas luzes e na TV.</p>

      {error && <div className="planob-error">{error}</div>}

      <div className="scene-grid">
        {scenes.map((s) => (
          <button
            key={s.id}
            className={`scene-btn${running === s.id ? ' busy' : ''}`}
            disabled={!!running}
            onClick={() => run(s)}
          >
            <span className="scene-icon">{s.icon}</span>
            <span className="scene-name">{running === s.id ? 'Executando…' : s.name}</span>
            <span className="scene-desc">{s.description}</span>
          </button>
        ))}
      </div>

      {scenes.length === 0 && !error && (
        <p className="planob-hint">Nenhuma cena em <code>scenes.json</code>.</p>
      )}

      {result && (
        <ul className="scene-result">
          {result.results.map((r, i) => (
            <li key={i} className={r.ok ? 'ok' : 'bad'}>
              {r.ok ? '✓' : '✗'} {r.label}
              {r.error && <span className="scene-result-err"> — {r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
