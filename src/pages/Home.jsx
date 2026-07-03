import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="home">
      <header className="home-header">
        <h1>Painel Local</h1>
        <p>Escolha o que controlar</p>
      </header>
      <div className="home-cards">
        <Link to="/lampadas" className="home-card lamps">
          <div className="home-card-icon">💡</div>
          <h2>Lâmpadas</h2>
          <p>Tuya / Smart Life — ligar, piscar, flicker e automações de quarto.</p>
        </Link>
        <Link to="/relogios" className="home-card clocks">
          <div className="home-card-icon">⏱</div>
          <h2>Relógios SIXLED</h2>
          <p>Controle sincronizado dos cronômetros WiFi (start/pause/stop, brilho, volume, config).</p>
        </Link>
        <Link to="/plano-b" className="home-card planob">
          <div className="home-card-icon">📡</div>
          <h2>Fita de LED (Plano B)</h2>
          <p>Liga, desliga e pisca a fita via Smart IR direto na rede Wi-Fi (tuyapi) — sem nuvem.</p>
        </Link>
      </div>
    </div>
  );
}
