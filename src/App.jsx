import { NavLink, Route, Routes } from 'react-router-dom';
import Relogio from './pages/Relogio.jsx';
import Quarto from './pages/Quarto.jsx';
import Porao from './pages/Porao.jsx';
import Musica from './pages/Musica.jsx';
import Config from './pages/Config.jsx';
import { useChrono, chronoDisplayText } from './lib/localChrono.js';

const STATE_LABEL = {
  idle: 'Parado',
  preparing: 'Preparando',
  running: 'Rodando',
  paused: 'Pausado',
  finished: 'Finalizado',
};

function NavChrono() {
  const snap = useChrono();
  return (
    <div className={`nav-sixled ${snap.state}`} title={STATE_LABEL[snap.state]}>
      <span className="nav-sixled-dot" />
      <span className="nav-sixled-time">{chronoDisplayText(snap)}</span>
    </div>
  );
}

const navClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

export default function App() {
  return (
    <div className="shell">
      <nav className="shell-nav">
        <NavLink to="/relogio" className={navClass}>Relógio</NavLink>
        <NavLink to="/quarto" className={navClass}>Quarto</NavLink>
        <NavLink to="/porao" className={navClass}>Porão</NavLink>
        <NavLink to="/musica" className={navClass}>Música</NavLink>
        <NavLink to="/config" className={navClass}>Configuração</NavLink>
        <NavChrono />
      </nav>
      <main className="shell-main">
        <Routes>
          <Route path="/relogio" element={<Relogio />} />
          <Route path="/quarto" element={<Quarto />} />
          <Route path="/porao" element={<Porao />} />
          <Route path="/musica" element={<Musica />} />
          <Route path="/config" element={<Config />} />
          <Route path="*" element={<Relogio />} />
        </Routes>
      </main>
    </div>
  );
}
