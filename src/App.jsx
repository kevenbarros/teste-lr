import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Lamps from './pages/Lamps.jsx';
import Relogio from './pages/Relogio.jsx';

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
