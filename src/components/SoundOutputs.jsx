import { useEffect, useState } from 'react';
import { soundApi } from '../lib/soundApi.js';
import '../pages/Sons.css';

// Escolha das caixas de saída (1 ou mais). Vale para os sons da aba Porão E para
// o som disparado ao "Iniciar piscar". Persistido em sound-config.json.
export default function SoundOutputs() {
  const [devices, setDevices] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await soundApi.devices();
      setDevices(data.devices || []);
      setOutputs(data.outputs || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (name) => {
    setError(null);
    const has = outputs.some((o) => o.name === name);
    if (has && outputs.length === 1) {
      setError('pelo menos uma caixa deve ficar selecionada');
      return;
    }
    const next = has
      ? outputs.filter((o) => o.name !== name)
      : [...outputs, { name, volume: 40 }];
    soundApi.setOutputs(next)
      .then((s) => setOutputs(s.outputs || []))
      .catch((err) => setError(err.message));
  };

  // Caixas salvas mas ausentes da lista atual (ex.: desligadas) ainda aparecem.
  const offline = outputs.filter((o) => !devices.includes(o.name)).map((o) => o.name);
  const allNames = [...devices, ...offline];

  return (
    <section className="planob-card">
      <h2>Caixas de som</h2>
      <p className="planob-hint">
        Marque 1 ou mais caixas. Vale para os sons da aba <strong>Porão</strong> e para o som do
        "Iniciar piscar". O volume de cada caixa é ajustado na aba Porão.
      </p>
      {error && <div className="planob-error">{error}</div>}

      <div className="sons-device">
        {allNames.map((name) => {
          const on = outputs.some((o) => o.name === name);
          const isOffline = offline.includes(name);
          return (
            <div key={name} className={`sons-out ${on ? 'on' : ''}`}>
              <label className="sons-out-check">
                <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                {name}{isOffline && <span className="sons-out-offline"> (não encontrada)</span>}
              </label>
            </div>
          );
        })}
        {allNames.length === 0 && <p className="planob-hint">Nenhuma saída de áudio encontrada.</p>}
      </div>

      <div className="planob-row" style={{ marginTop: '0.75rem' }}>
        <button className="learn" onClick={load} disabled={loading}>
          {loading ? 'Procurando...' : '↻ Atualizar lista'}
        </button>
      </div>
    </section>
  );
}
