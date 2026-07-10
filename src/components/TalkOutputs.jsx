import { useEffect, useState } from 'react';
import { talkApi } from '../lib/talkApi.js';
import '../pages/Sons.css';

// Configuração do interfone (aba Falar): quais caixas recebem a voz e qual
// microfone captura. Independente das caixas de sons. Persiste em talk-config.json.
export default function TalkOutputs() {
  const [devices, setDevices] = useState([]);
  const [mics, setMics] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [mic, setMic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await talkApi.devices();
      setDevices(data.devices || []);
      setMics(data.mics || []);
      setOutputs(data.outputs || []);
      setMic(data.mic || '');
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
    const next = has
      ? outputs.filter((o) => o.name !== name)
      : [...outputs, { name, volume: 40 }];
    if (!next.length) {
      setError('pelo menos uma caixa deve ficar selecionada');
      return;
    }
    talkApi.setOutputs(next)
      .then((s) => setOutputs(s.outputs || []))
      .catch((err) => setError(err.message));
  };

  const changeMic = (value) => {
    setError(null);
    talkApi.setMic(value)
      .then((s) => setMic(s.mic || ''))
      .catch((err) => setError(err.message));
  };

  // Caixas salvas mas ausentes da lista atual (ex.: Bluetooth desconectado).
  const offline = outputs.filter((o) => !devices.includes(o.name)).map((o) => o.name);
  const allNames = [...devices, ...offline];

  return (
    <section className="planob-card">
      <h2>Falar nas caixas (interfone)</h2>
      <p className="planob-hint">
        Caixas que recebem a sua voz na aba <strong>Falar</strong>. Para a Alexa aparecer aqui,
        ela precisa estar conectada ao PC por Bluetooth ("Alexa, conectar Bluetooth").
        As caixas marcadas ficam <strong>fora do som geral do PC</strong>: se o Windows tentar
        usá-las como saída padrão, o sistema devolve o padrão para a caixa anterior — nelas
        só sai a voz da aba Falar (e os sons, se marcadas em "Caixas de som").
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

      <div className="planob-row" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.6rem' }}>
        <label className="planob-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Microfone:
          <select value={mic} onChange={(e) => changeMic(e.target.value)}>
            <option value="">Padrão do Windows</option>
            {mics.map((m) => <option key={m} value={m}>{m}</option>)}
            {mic && !mics.includes(mic) && <option value={mic}>{mic} (não encontrado)</option>}
          </select>
        </label>
        <button className="learn" onClick={load} disabled={loading}>
          {loading ? 'Procurando...' : '↻ Atualizar lista'}
        </button>
      </div>
    </section>
  );
}
