import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSixledApi } from '../lib/sixledApi.js';
import {
  useChrono, chronoDisplayText, startChrono, pauseChrono, stopChrono, restartChrono,
  addChronoTime, getChronoSnapshot, msToHHMMSS,
} from '../lib/localChrono.js';
import './Relogio.css';

const DEFAULT_CONFIG = {
  cre: '1', prep: '3', so1: '1', sof: '2', tp1: '01:00:00',
  bpt: true, bp1: true, bi1: false,
  eh: true, tph: '5', ed: true, tpd: '2', et: true, tpt: '2',
};

const STATUS_LABEL = { '-1': 'Offline', 0: 'Parado', 1: 'Pausado', 2: 'Rodando' };
const STATUS_COLOR = { '-1': '#4a4a5a', 0: '#c0392b', 1: '#d68910', 2: '#27ae60' };

const IPS_STORAGE_KEY = 'sixled:ips';
const DEFAULT_IPS = ['192.168.1.21', '192.168.1.7'];

function loadStoredIps() {
  try {
    const raw = localStorage.getItem(IPS_STORAGE_KEY);
    if (!raw) return DEFAULT_IPS;
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts[1]];
  } catch {}
  return DEFAULT_IPS;
}

export default function Relogio() {
  const [devices, setDevices] = useState([]);
  const [brightness, setBrightness] = useState(100);
  const [volume, setVolume] = useState(80);
  const [power, setPower] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastCmd, setLastCmd] = useState(null);

  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState(null);

  const [ips, setIps] = useState(loadStoredIps);
  const [ipDraft1, setIpDraft1] = useState(ips[0]);
  const [ipDraft2, setIpDraft2] = useState(ips[1]);

  const api = useMemo(() => buildSixledApi(ips), [ips]);
  const ipsDirty = ipDraft1.trim() !== ips[0] || ipDraft2.trim() !== ips[1];

  const pollRef = useRef(undefined);

  useEffect(() => {
    void fetchStatus();
    pollRef.current = setInterval(() => { void fetchStatus(); }, 1000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function applyIps() {
    const next = [ipDraft1.trim(), ipDraft2.trim()];
    if (!next[0] || !next[1]) return;
    setIps(next);
    try { localStorage.setItem(IPS_STORAGE_KEY, next.join(',')); } catch {}
    window.dispatchEvent(new Event('sixled:ips-changed'));
    setDevices([]);
  }

  async function fetchStatus() {
    try {
      const data = await api.status();
      setDevices(data);
    } catch {}
  }

  async function sendCmd(n, label) {
    setBusy(true); setLastCmd(label);
    // Local chrono mirrors the physical command (the SIXLED firmware doesn't
    // expose its displayed time, so we run our own countdown in sync).
    if (n === 1) startChrono();
    else if (n === 4) restartChrono();
    else if (n === 2) pauseChrono();
    else if (n === 3) stopChrono();
    try { await api.cmd(n); await fetchStatus(); }
    finally { setBusy(false); setTimeout(() => setLastCmd(null), 1500); }
  }

  async function handleAddTime(minutes) {
    const extraMs = minutes * 60 * 1000;
    addChronoTime(extraMs);
    const snap = getChronoSnapshot();
    const tp1 = msToHHMMSS(snap.remainingMs);
    const shouldRestart = snap.state === 'running' || snap.state === 'preparing' || snap.state === 'finished';

    setLastCmd(`+${minutes} min`);
    setBusy(true);
    try {
      await api.extend(tp1, shouldRestart);
    } catch {}
    finally {
      setBusy(false);
      setTimeout(() => setLastCmd(null), 1500);
    }
  }

  const commitBrightness = (e) => { void api.par(1, e.currentTarget.value); };
  const commitVolume = (e) => { void api.par(3, e.currentTarget.value); };
  const togglePower = () => {
    const next = !power;
    setPower(next);
    void api.par(2, next ? 1 : 0);
  };

  async function loadConfig() {
    setConfigLoading(true);
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
      if (cfg.brightness != null) setBrightness(cfg.brightness);
      if (cfg.volume != null) setVolume(cfg.volume);
      setConfigMsg({ text: 'Configurações carregadas do Relógio 1', ok: true });
    } catch {
      setConfigMsg({ text: 'Falha ao carregar configurações', ok: false });
    } finally {
      setConfigLoading(false);
      setTimeout(() => setConfigMsg(null), 3000);
    }
  }

  async function saveConfig() {
    setConfigSaving(true);
    try {
      await api.saveConfig(config);
      setConfigMsg({ text: 'Salvo nos dois relógios com sucesso', ok: true });
    } catch {
      setConfigMsg({ text: 'Erro ao salvar configurações', ok: false });
    } finally {
      setConfigSaving(false);
      setTimeout(() => setConfigMsg(null), 3000);
    }
  }

  const setField = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));
  const testSound = (soundId) => api.par(4, soundId);

  const allOnline = devices.length > 0 && devices.every(d => d.online);
  const anyOffline = devices.some(d => !d.online);
  const chrono = useChrono();

  return (
    <div className="relogio-page">

      <header className="rl-header">
        <div className="rl-logo">
          <span className="rl-logo-dot" /><span className="rl-logo-dot" />
        </div>
        <h1 className="rl-title">SIXLED Sync</h1>
        <p className="rl-sub">Controle sincronizado dos dois relógios</p>
        <div className={`rl-bigtime ${chrono.state}`}>
          {chronoDisplayText(chrono)}
        </div>
      </header>

      <section className="rl-ip-section">
        <div className="rl-ip-row">
          <label className="rl-ip-field">
            <span>IP Relógio 1</span>
            <input type="text" className="rl-ip-input" value={ipDraft1}
              onChange={e => setIpDraft1(e.target.value)}
              placeholder="192.168.1.x"
              onKeyDown={e => { if (e.key === 'Enter') applyIps(); }} />
          </label>
          <label className="rl-ip-field">
            <span>IP Relógio 2</span>
            <input type="text" className="rl-ip-input" value={ipDraft2}
              onChange={e => setIpDraft2(e.target.value)}
              placeholder="192.168.1.x"
              onKeyDown={e => { if (e.key === 'Enter') applyIps(); }} />
          </label>
          <button className="rl-ip-apply" onClick={applyIps} disabled={!ipsDirty}>
            Conectar
          </button>
        </div>
      </section>

      <section className="rl-devices-section">
        {devices.length === 0 ? (
          <div className="rl-connecting"><span className="rl-spinner" /> Conectando…</div>
        ) : (
          <div className="rl-devices-grid">
            {devices.map(d => (
              <div key={d.ip} className={`rl-device-card ${d.online ? 'online' : 'offline'}`}>
                <div className="rl-device-name">{d.name}</div>
                <div className="rl-device-ip">{d.ip}</div>
                <div className="rl-device-badge"
                  style={{ background: STATUS_COLOR[d.online ? d.stc : -1] }}>
                  {STATUS_LABEL[d.online ? d.stc : -1]}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className={`rl-sync ${allOnline ? 'synced' : anyOffline ? 'partial' : ''}`}>
          {allOnline ? '✓ Ambos os relógios sincronizados'
            : anyOffline ? '⚠ Um relógio está offline'
            : 'Verificando conexão…'}
        </div>
      </section>

      <section className="rl-control-panel">
        <h2 className="rl-panel-title">Controles</h2>

        {lastCmd && (
          <div className="rl-toast rl-toast-info">Enviado para ambos: <strong>{lastCmd}</strong></div>
        )}

        <div className="rl-cmd-grid">
          {[
            [1, '▶', 'Start', 'start'],
            [2, '⏸', 'Pause', 'pause'],
            [3, '⏹', 'Stop', 'stop'],
            [4, '↺', 'Restart', 'restart'],
          ].map(([n, icon, label, cls]) => (
            <button key={n} className={`rl-cmd-btn ${cls}`}
              onClick={() => sendCmd(n, label)} disabled={busy}>
              <span className="rl-cmd-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="rl-addtime-row">
          {[1, 5, 10].map(min => (
            <button key={min} className="rl-addtime-btn"
              onClick={() => handleAddTime(min)} disabled={busy}>
              +{min} min
            </button>
          ))}
        </div>

        <div className="rl-sliders">
          <div className="rl-slider-row">
            <div className="rl-slider-header">
              <span>☀ Brilho</span>
              <span className="rl-slider-value">{brightness}%</span>
            </div>
            <input type="range" min="0" max="100" value={brightness} className="rl-slider"
              onChange={e => setBrightness(Number(e.target.value))}
              onMouseUp={commitBrightness} onTouchEnd={commitBrightness} />
          </div>
          <div className="rl-slider-row">
            <div className="rl-slider-header">
              <span>♪ Volume</span>
              <span className="rl-slider-value">{volume}%</span>
            </div>
            <input type="range" min="0" max="100" value={volume} className="rl-slider"
              onChange={e => setVolume(Number(e.target.value))}
              onMouseUp={commitVolume} onTouchEnd={commitVolume} />
          </div>
        </div>

        <div className="rl-power-row">
          <span className="rl-power-label">Energia</span>
          <button className={`rl-power-toggle ${power ? 'on' : 'off'}`} onClick={togglePower}>
            <span className="rl-power-knob" />
            <span className="rl-power-text">{power ? 'LIGADO' : 'DESLIGADO'}</span>
          </button>
        </div>
      </section>

      <section className="rl-config-section">
        <button className="rl-config-toggle" onClick={() => {
          setShowConfig(v => !v);
          if (!showConfig) void loadConfig();
        }}>
          <span>⚙ Configurações do Cronômetro</span>
          <span className="rl-chevron">{showConfig ? '▲' : '▼'}</span>
        </button>

        {showConfig && (
          <div className="rl-config-panel">

            {configLoading && (
              <div className="rl-connecting" style={{ padding: '1rem' }}>
                <span className="rl-spinner" /> Carregando do Relógio 1…
              </div>
            )}

            {configMsg && (
              <div className={`rl-toast ${configMsg.ok ? 'rl-toast-ok' : 'rl-toast-err'}`}>
                {configMsg.text}
              </div>
            )}

            <fieldset className="rl-cfg-group">
              <legend>Tipo de contagem</legend>
              <div className="rl-radio-group">
                {[['1', 'Decrescente ↓'], ['2', 'Crescente ↑']].map(([val, label]) => (
                  <label key={val} className="rl-radio-label">
                    <input type="radio" name="cre" value={val}
                      checked={config.cre === val}
                      onChange={() => setField('cre', val)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rl-cfg-group">
              <legend>Tempos</legend>
              <div className="rl-cfg-row">
                <label className="rl-cfg-label">
                  Duração
                  <input type="time" step="1" value={config.tp1} className="rl-input-time"
                    onChange={e => setField('tp1', e.target.value)} />
                </label>
                <label className="rl-cfg-label">
                  Preparo
                  <div className="rl-input-with-unit">
                    <input type="number" min="0" max="30" value={config.prep} className="rl-input-sm"
                      onChange={e => setField('prep', e.target.value)} />
                    <span className="rl-unit">s</span>
                  </div>
                </label>
              </div>
            </fieldset>

            <fieldset className="rl-cfg-group">
              <legend>Sons (1 – 39)</legend>
              <div className="rl-cfg-row">
                <label className="rl-cfg-label">
                  Início
                  <div className="rl-sound-row">
                    <input type="number" min="1" max="39" value={config.so1} className="rl-input-sm"
                      onChange={e => setField('so1', e.target.value)} />
                    <button className="rl-sound-test"
                      onClick={() => void testSound(config.so1)}
                      title="Testar som em ambos os relógios">♪</button>
                  </div>
                </label>
                <label className="rl-cfg-label">
                  Fim
                  <div className="rl-sound-row">
                    <input type="number" min="1" max="39" value={config.sof} className="rl-input-sm"
                      onChange={e => setField('sof', e.target.value)} />
                    <button className="rl-sound-test"
                      onClick={() => void testSound(config.sof)}
                      title="Testar som em ambos os relógios">♪</button>
                  </div>
                </label>
              </div>
            </fieldset>

            <fieldset className="rl-cfg-group">
              <legend>Bips</legend>
              <div className="rl-checks-col">
                {[
                  ['bpt', 'Bips nas teclas'],
                  ['bp1', 'Bip nos 10 segundos finais'],
                  ['bi1', 'Bips nos 3 segundos finais'],
                ].map(([key, label]) => (
                  <label key={key} className="rl-check-label">
                    <input type="checkbox" checked={config[key]}
                      onChange={e => setField(key, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rl-cfg-group">
              <legend>Exibição no relógio</legend>
              <div className="rl-display-grid">
                {[
                  ['eh', 'tph', 'Hora'],
                  ['ed', 'tpd', 'Data'],
                  ['et', 'tpt', 'Temperatura'],
                ].map(([checkKey, durKey, label]) => (
                  <div key={checkKey} className="rl-display-row">
                    <label className="rl-check-label">
                      <input type="checkbox" checked={config[checkKey]}
                        onChange={e => setField(checkKey, e.target.checked)} />
                      {label}
                    </label>
                    <div className={`rl-input-with-unit ${!config[checkKey] ? 'disabled' : ''}`}>
                      <input type="number" min="0" max="99" value={config[durKey]}
                        disabled={!config[checkKey]} className="rl-input-sm"
                        onChange={e => setField(durKey, e.target.value)} />
                      <span className="rl-unit">s</span>
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="rl-config-actions">
              <button className="rl-btn-secondary" onClick={() => void loadConfig()}
                disabled={configLoading}>
                {configLoading ? '⟳ Carregando…' : '⟳ Recarregar do Relógio 1'}
              </button>
              <button className="rl-btn-primary" onClick={() => void saveConfig()}
                disabled={configSaving}>
                {configSaving ? '⏳ Salvando…' : '💾 Salvar nos dois relógios'}
              </button>
            </div>

          </div>
        )}
      </section>

      <footer className="rl-footer">
        Comandos enviados simultaneamente para os dois relógios
      </footer>
    </div>
  );
}
