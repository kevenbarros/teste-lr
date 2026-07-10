import TalkPanel from '../components/TalkPanel.jsx';
import './PlanoB.css';

// Interfone ("drop in"): abre o microfone do PC e a voz sai ao vivo nas caixas
// escolhidas — ex.: Alexa/Echo conectada ao PC por Bluetooth.
export default function Falar() {
  return (
    <div className="planob-page">
      <h1>Falar</h1>
      <p className="planob-sub">
        Abra o microfone e fale: sua voz sai ao vivo nas caixas escolhidas
        (ex.: Alexa conectada por Bluetooth). Caixas e microfone na aba Configuração.
      </p>
      <TalkPanel />
    </div>
  );
}
