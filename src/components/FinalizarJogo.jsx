import { useMemo, useState } from 'react';
import { getChronoSnapshot, stopChrono } from '../lib/localChrono.js';
import { buildSixledApi } from '../lib/sixledApi.js';
import { lendasApi } from '../lib/lendasApi.js';
import './FinalizarJogo.css';

const DEFAULT_IPS = ['192.168.1.21', '192.168.1.7'];

function loadStoredIps() {
  try {
    const raw = localStorage.getItem('sixled:ips');
    if (raw) {
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) return [parts[0], parts[1]];
    }
  } catch { /* ignore */ }
  return DEFAULT_IPS;
}

export default function FinalizarJogo() {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  const hasMultipleRooms = useMemo(
    () => new Set(teams.map((t) => t.roomId)).size > 1,
    [teams],
  );

  function resetModal() {
    setSelected(null);
    setError(null);
    setDone(null);
  }

  async function handleFinalize() {
    // 1) Captura o TEMPO RESTANTE antes de parar (é o que vai pro ranking).
    const snap = getChronoSnapshot();
    const remainingSecs = Math.round((snap.remainingMs || 0) / 1000);
    setMinutes(Math.floor(remainingSecs / 60));
    setSeconds(remainingSecs % 60);

    // 2) Para o cronômetro local e os dois relógios físicos (cmd 3 = Stop).
    stopChrono();
    try { await buildSixledApi(loadStoredIps()).cmd(3); } catch { /* relógio offline: segue */ }

    // 3) Abre o popup e carrega as equipes do dia.
    resetModal();
    setOpen(true);
    setLoading(true);
    setTeams([]);
    try {
      const list = await lendasApi.teams();
      setTeams(list);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar as equipes.');
    } finally {
      setLoading(false);
    }
  }

  function selectTeam(team) {
    setSelected(team);
    setError(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!selected) return;
    const timeSeconds = Math.max(0, minutes) * 60 + Math.max(0, Math.min(59, seconds));
    if (timeSeconds <= 0) {
      setError('Informe o tempo da equipe (minutos e segundos).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await lendasApi.saveRanking({
        sessionId: selected.id,
        timeSeconds,
        teamName: selected.customerName || undefined,
      });
      setDone({ team: selected.customerName || 'Equipe', timeSeconds });
    } catch (err) {
      setError(err.message || 'Não foi possível salvar no ranking.');
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setOpen(false);
    resetModal();
  }

  return (
    <>
      <button className="fj-btn" onClick={handleFinalize} title="Parar os relógios e salvar o tempo da equipe">
        <span className="fj-btn-icon">■</span>
        <span className="fj-btn-label">Finalizar jogo</span>
      </button>

      {open && (
        <div className="fj-overlay" onClick={close}>
          <div className="fj-modal" onClick={(e) => e.stopPropagation()}>
            <header className="fj-modal-head">
              <h2>{done ? 'Tempo salvo' : selected ? 'Confirmar tempo' : 'Equipes de hoje'}</h2>
              <button className="fj-close" onClick={close} aria-label="Fechar">×</button>
            </header>

            {error && <div className="fj-error">{error}</div>}

            {done ? (
              <div className="fj-done">
                <div className="fj-done-check">✓</div>
                <p>
                  <strong>{done.team}</strong> — tempo{' '}
                  <strong>{fmt(done.timeSeconds)}</strong> salvo no ranking.
                </p>
                <button className="fj-primary" onClick={close}>Fechar</button>
              </div>
            ) : selected ? (
              <form className="fj-confirm" onSubmit={handleSave}>
                <div className="fj-selected">
                  <span className="fj-selected-time">{selected.startTime || '—'}</span>
                  <span className="fj-selected-name">{selected.customerName || 'Sem nome'}</span>
                  {hasMultipleRooms && selected.roomName && (
                    <span className="fj-selected-room">{selected.roomName}</span>
                  )}
                </div>

                <label className="fj-time-label">Tempo da equipe</label>
                <div className="fj-time-row">
                  <input
                    type="number" min={0} className="fj-time-input"
                    value={minutes}
                    onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <span className="fj-time-unit">min</span>
                  <input
                    type="number" min={0} max={59} className="fj-time-input"
                    value={seconds}
                    onChange={(e) => setSeconds(Math.min(59, Math.max(0, Number(e.target.value) || 0)))}
                  />
                  <span className="fj-time-unit">seg</span>
                </div>

                <div className="fj-actions">
                  <button type="button" className="fj-secondary" onClick={resetModal} disabled={saving}>
                    ← Voltar
                  </button>
                  <button type="submit" className="fj-primary" disabled={saving}>
                    {saving ? 'Salvando…' : 'Salvar no ranking'}
                  </button>
                </div>
              </form>
            ) : loading ? (
              <div className="fj-loading">Carregando equipes…</div>
            ) : teams.length === 0 ? (
              <div className="fj-empty">Nenhuma equipe agendada para hoje.</div>
            ) : (
              <ul className="fj-list">
                {teams.map((t) => (
                  <li key={t.id}>
                    <button className="fj-team" onClick={() => selectTeam(t)}>
                      <span className="fj-team-time">{t.startTime || '—'}</span>
                      <span className="fj-team-name">{t.customerName || 'Sem nome'}</span>
                      {hasMultipleRooms && t.roomName && (
                        <span className="fj-team-room">{t.roomName}</span>
                      )}
                      <span className="fj-team-arrow">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
