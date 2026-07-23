import { useState } from 'react';
import { irLocalApi } from '../lib/irLocalApi.js';
import { useIrLocal, BLASTER_PORAO, BLASTER_QUARTO } from '../lib/useIrLocal.js';
import '../pages/PlanoB.css';

// Uma linha por Smart IR: status, IP atual e botão que dispara a redescoberta
// na rede (o servidor salva o IP novo em ir-local.json automaticamente).
function BlasterRow({ blaster, label }) {
  const { info, refresh } = useIrLocal(blaster);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }

  const search = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await irLocalApi.reconnect(blaster);
      setResult(r.connected
        ? { ok: true, text: `✅ Encontrado em ${r.ip} — IP salvo.` }
        : { ok: false, text: 'Não apareceu na rede. Confira se o aparelho está ligado no Wi-Fi.' });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const configured = info?.configured;
  const connected = info?.connected;

  return (
    <div className="irnet-row">
      <div className="irnet-info">
        <span className="irnet-name">{label}</span>
        {configured === false ? (
          <span className="irnet-state bad">não configurado em ir-local.json</span>
        ) : (
          <span className={`irnet-state ${connected ? 'ok' : 'bad'}`}>
            {connected ? '● conectado' : '○ fora da rede'}
            {info?.ip && <code className="irnet-ip">{info.ip}</code>}
          </span>
        )}
      </div>
      <button
        className="ir-refresh"
        disabled={busy || configured === false}
        onClick={search}
        title="Procura o aparelho na rede (IP fixo → broadcast → varredura) e salva o IP novo"
      >
        {busy ? '⟳ procurando…' : '🔍 Procurar na rede'}
      </button>
      {result && <div className={`irnet-result ${result.ok ? 'ok' : 'bad'}`}>{result.text}</div>}
    </div>
  );
}

export default function IrNetwork() {
  return (
    <section className="planob-card">
      <h2>Rede dos Smart IR</h2>
      <p className="planob-hint">
        O roteador troca os IPs de vez em quando e os controles "somem" (fita continua
        acesa/apagada e nada responde). Clique em <strong>Procurar na rede</strong> para
        reencontrar o aparelho — o IP novo é salvo sozinho no <code>ir-local.json</code>.
      </p>
      <BlasterRow blaster={BLASTER_PORAO} label="Fita de LED (porão)" />
      <BlasterRow blaster={BLASTER_QUARTO} label="TV e lâmpada IR (quarto)" />
    </section>
  );
}
