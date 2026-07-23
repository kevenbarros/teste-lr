import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import '../pages/PlanoB.css';

// Linha de status de um Smart IR com botão "Atualizar": força a reconexão no
// servidor (IP fixo → broadcast → varredura da rede) e re-consulta o status.
export default function IrStatus({ info, refresh, blaster = 'porao', label = 'Smart IR' }) {
  const [searching, setSearching] = useState(false);

  if (!info) return null;

  if (!info.configured) {
    return (
      <div className="planob-error">
        Smart IR "{blaster}" não configurado. Preencha em <code>ir-local.json</code> e reinicie a API.
      </div>
    );
  }

  const connected = info.connected;

  const search = async () => {
    setSearching(true);
    try {
      await irLocalApi.reconnect(blaster);
    } catch (err) {
      alert(err.message);
    } finally {
      await refresh?.();
      setSearching(false);
    }
  };

  return (
    <div className={`planob-status ir-status ${connected ? 'ok' : 'bad'}`}>
      <span>
        {searching
          ? `◌ Procurando ${label} na rede...`
          : connected ? `● Conectado ao ${label}` : `○ ${label} fora da rede`}
      </span>
      <button className="ir-refresh" disabled={searching} onClick={search} title="Procurar o blaster na rede agora">
        {searching ? '⟳ procurando…' : '⟳ Atualizar'}
      </button>
    </div>
  );
}
