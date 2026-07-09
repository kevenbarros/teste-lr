import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import { useIrLocal } from '../lib/useIrLocal.js';
import '../pages/PlanoB.css';
import './IrRemote.css';

// Sugestões comuns de botões de TV (o usuário pode digitar qualquer nome).
const SUGGESTIONS = [
  'Power', 'Fonte', 'Mute', 'Vol +', 'Vol -', 'Canal +', 'Canal -',
  'OK', 'Cima', 'Baixo', 'Esquerda', 'Direita', 'Voltar', 'Menu', 'Home',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
];

// Controle remoto IR genérico: mostra os botões já copiados (envia ao clicar) e
// permite adicionar novos botões copiando do controle físico (learn/study).
export default function IrRemote({ blaster, device, deviceName, title }) {
  const { info, refresh } = useIrLocal(blaster);
  const [busy, setBusy] = useState(null); // "learn:<nome>" ou "send:<nome>"
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState(null);

  const configured = info?.configured;
  const connected = info?.connected;
  const keys = info?.devices?.[device]?.keys || [];

  const copy = async (name) => {
    const key = name.trim();
    if (!key) return;
    setBusy(`learn:${key}`);
    setMsg(null);
    try {
      await irLocalApi.learn(device, deviceName, key, blaster);
      setMsg(`Botão "${key}" copiado!`);
      setNewName('');
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const send = async (key) => {
    setBusy(`send:${key}`);
    try {
      await irLocalApi.send(device, key, blaster);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const forget = async (key) => {
    if (!window.confirm(`Remover o botão "${key}"?`)) return;
    try {
      await irLocalApi.forget(device, key);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const learning = busy?.startsWith('learn:');

  return (
    <section className="planob-card">
      <h2>{title}</h2>

      {configured ? (
        <div className={`planob-status ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● Conectado ao Smart IR do quarto' : '○ Procurando o Smart IR do quarto...'}
        </div>
      ) : (
        <div className="planob-error">
          Smart IR do quarto não configurado. Preencha o blaster <code>quarto</code> em <code>ir-local.json</code>
          {' '}(id, local key e ip) e reinicie a API.
        </div>
      )}

      {keys.length > 0 ? (
        <div className="irtv-grid">
          {keys.map((key) => (
            <div key={key} className="irtv-item">
              <button className="irtv-btn" disabled={!connected || !!busy} onClick={() => send(key)}>
                {busy === `send:${key}` ? '···' : key}
              </button>
              <button className="irtv-del" title={`Remover "${key}"`} onClick={() => forget(key)}>×</button>
            </div>
          ))}
        </div>
      ) : (
        configured && <p className="planob-hint">Nenhum botão ainda. Copie os botões do controle da TV abaixo.</p>
      )}

      <div className="irtv-add">
        <input
          list="tv-btn-suggestions"
          placeholder="Nome do botão (ex: Power, Vol +)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') copy(newName); }}
          disabled={!configured || !!busy}
        />
        <datalist id="tv-btn-suggestions">
          {SUGGESTIONS.map((s) => <option key={s} value={s} />)}
        </datalist>
        <button className="learn" disabled={!configured || !!busy || !newName.trim()} onClick={() => copy(newName)}>
          {learning ? 'Aguardando controle...' : 'Copiar botão'}
        </button>
      </div>
      <p className="planob-hint">
        Clique em <strong>Copiar botão</strong>, então aponte o controle da TV para o Smart IR e
        <strong> pressione o botão</strong> desejado (você tem 30s).
      </p>
      {msg && <div className="planob-ok">{msg}</div>}
    </section>
  );
}
