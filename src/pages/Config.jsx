import { useIrLocal } from '../lib/useIrLocal.js';
import SoundOutputs from '../components/SoundOutputs.jsx';
import LedLearn from '../components/LedLearn.jsx';
import SpotifySetup from '../components/SpotifySetup.jsx';
import IrNetwork from '../components/IrNetwork.jsx';
import './PlanoB.css';

export default function Config() {
  const { info, error, refresh } = useIrLocal();

  return (
    <div className="planob-page">
      <h1>Configuração</h1>
      <p className="planob-sub">Caixas de som, Spotify e aprendizado do controle da fita de LED.</p>
      <p className="planob-sub">Rede dos Smart IR, caixas de som e aprendizado do controle da fita de LED.</p>

      <IrNetwork />

      <SoundOutputs />
      <SpotifySetup />

      {error && <div className="planob-error">Erro Smart IR: {error}</div>}
      <LedLearn info={info} refresh={refresh} />
    </div>
  );
}
