import { useIrLocal } from '../lib/useIrLocal.js';
import SoundOutputs from '../components/SoundOutputs.jsx';
import TalkOutputs from '../components/TalkOutputs.jsx';
import LedLearn from '../components/LedLearn.jsx';
import './PlanoB.css';

export default function Config() {
  const { info, error, refresh } = useIrLocal();

  return (
    <div className="planob-page">
      <h1>Configuração</h1>
      <p className="planob-sub">Caixas de som e aprendizado do controle da fita de LED.</p>

      <SoundOutputs />
      <TalkOutputs />

      {error && <div className="planob-error">Erro Smart IR: {error}</div>}
      <LedLearn info={info} refresh={refresh} />
    </div>
  );
}
