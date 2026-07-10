import { useLamps, findLamp } from '../lib/useLamps.js';
import QuartoAutomation from '../components/QuartoAutomation.jsx';
import LampCard from '../components/LampCard.jsx';
import TvRemote from '../components/TvRemote.jsx';
import IrLampCard from '../components/IrLampCard.jsx';
import './Lamps.css';
import './Quarto.css';

export default function Quarto() {
  const { lamps, error, refresh } = useLamps();
  const entrada = findLamp(lamps, /entrada/i);
  const saida = findLamp(lamps, /sa[ií]da/i);

  return (
    <div className="quarto-page">
      {(error || (lamps.length > 0 && !entrada && !saida)) && (
        <header className="quarto-head">
          {error && <div className="lamps-error">Erro: {error}</div>}
          {lamps.length > 0 && !entrada && !saida && (
            <div className="lamps-error">Lâmpadas "Quarto entrada/saída" não encontradas em devices.json.</div>
          )}
        </header>
      )}

      <QuartoAutomation />

      <div className="quarto-grid">
        <div className="quarto-col quarto-col-lamp1">
          {entrada && <LampCard lamp={entrada} onChange={refresh} />}
        </div>
        <div className="quarto-col quarto-col-lamp2">
          {saida && <LampCard lamp={saida} onChange={refresh} />}
        </div>
        <div className="quarto-col quarto-col-tv">
          <TvRemote />
        </div>
        <div className="quarto-col quarto-col-irlamp">
          <IrLampCard />
        </div>
      </div>
    </div>
  );
}
