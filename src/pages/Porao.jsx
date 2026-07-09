import { useLamps, findLamp } from '../lib/useLamps.js';
import { useIrLocal } from '../lib/useIrLocal.js';
import LampCard from '../components/LampCard.jsx';
import LedControl from '../components/LedControl.jsx';
import LedBlink from '../components/LedBlink.jsx';
import SoundBoard from '../components/SoundBoard.jsx';
import './Lamps.css';
import './PlanoB.css';

export default function Porao() {
  const { lamps, error, refresh } = useLamps();
  const { info, error: irError, refresh: irRefresh } = useIrLocal();
  const sala = findLamp(lamps, /sala|por[aã]o/i);

  return (
    <div className="planob-page">
      <h1>Porão</h1>
      {error && <div className="lamps-error">Erro: {error}</div>}

      <div className="lamps-grid" style={{ marginBottom: '1rem' }}>
        {sala && <LampCard lamp={sala} onChange={refresh} />}
      </div>
      {lamps.length > 0 && !sala && (
        <p className="lamps-error">Lâmpada "Sala porão" não encontrada em devices.json.</p>
      )}

      {irError && <div className="planob-error">Erro Smart IR: {irError}</div>}
      <LedControl info={info} refresh={irRefresh} />
      <LedBlink info={info} refresh={irRefresh} />

      <SoundBoard />
    </div>
  );
}
