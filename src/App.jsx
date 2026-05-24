import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Lamps from './pages/Lamps.jsx';
import Relogio from './pages/Relogio.jsx';
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

export default function App() {
  return (
    <div className="shell">
      <nav className="shell-nav">
        <NavLink to="/" end className="brand">⌂</NavLink>
        <NavLink to="/lampadas" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Lâmpadas
        </NavLink>
        <NavLink to="/relogios" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Relógios
        </NavLink>
        <NavChrono />
      </nav>
      <main className="shell-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lampadas" element={<Lamps />} />
          <Route path="/relogios" element={<Relogio />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}
