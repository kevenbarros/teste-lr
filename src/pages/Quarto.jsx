import { useLamps, findLamp } from '../lib/useLamps.js';
import { BLASTER_QUARTO, TV_DEVICE, TV_DEVICE_NAME } from '../lib/useIrLocal.js';
import QuartoAutomation from '../components/QuartoAutomation.jsx';
import LampCard from '../components/LampCard.jsx';
import IrRemote from '../components/IrRemote.jsx';
import './Lamps.css';

export default function Quarto() {
  const { lamps, error, refresh } = useLamps();
  const entrada = findLamp(lamps, /entrada/i);
  const saida = findLamp(lamps, /sa[ií]da/i);

  return (
    <div className="lamps-page">
      <h1>Quarto</h1>
      {error && <div className="lamps-error">Erro: {error}</div>}

      <QuartoAutomation />

      <section className="room-section">
        <h2 className="room-section-title">💡 Lâmpadas</h2>
        <div className="lamps-grid">
          {entrada && <LampCard lamp={entrada} onChange={refresh} />}
          {saida && <LampCard lamp={saida} onChange={refresh} />}
        </div>
        {lamps.length > 0 && !entrada && !saida && (
          <p className="lamps-error">Lâmpadas "Quarto entrada/saída" não encontradas em devices.json.</p>
        )}
      </section>

      <section className="room-section">
        <h2 className="room-section-title">📺 TV</h2>
        <IrRemote
          blaster={BLASTER_QUARTO}
          device={TV_DEVICE}
          deviceName={TV_DEVICE_NAME}
          title="Controle por infravermelho"
        />
      </section>
    </div>
  );
}
