import { useLamps, findLamp } from '../lib/useLamps.js';
import { useIrLocal } from '../lib/useIrLocal.js';
import LampCard from '../components/LampCard.jsx';
import LedControl from '../components/LedControl.jsx';
import LedBlink from '../components/LedBlink.jsx';
import SoundBoard from '../components/SoundBoard.jsx';
import './Lamps.css';
import './PlanoB.css';
import './Porao.css';

export default function Porao() {
  const { lamps, error, refresh } = useLamps();
  const { info, error: irError, refresh: irRefresh } = useIrLocal();
  const sala = findLamp(lamps, /sala|por[aã]o/i);

  return (
    <div className="porao-page">
      <header className="porao-head">
        {error && <div className="lamps-error">Erro: {error}</div>}
        {irError && <div className="planob-error">Erro Smart IR: {irError}</div>}
      </header>

      <div className="porao-grid">
        <div className="porao-col porao-col-lamp">
          {sala && <LampCard lamp={sala} onChange={refresh} />}
          {lamps.length > 0 && !sala && (
            <p className="lamps-error">Lâmpada "Sala porão" não encontrada em devices.json.</p>
          )}
        </div>

        <div className="porao-col porao-col-led">
          <LedControl info={info} refresh={irRefresh} />
          <LedBlink info={info} refresh={irRefresh} />
        </div>

        <div className="porao-col porao-col-sons">
          <SoundBoard />
        </div>
      </div>
    </div>
  );
}
