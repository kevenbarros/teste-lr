# Infravermelho (Smart IR) — guia definitivo

Como este projeto controla aparelhos por infravermelho usando os blasters Tuya
**localmente** (via `tuyapi`, sem nuvem). **Toda mudança envolvendo IR deve
seguir este documento.**

## Arquitetura

```
controle físico ──IR──> blaster Tuya ──Wi-Fi/LAN──> server.js ──HTTP──> React
                        (aprende e                  (tuyapi)            (abas)
                         reemite códigos)
```

- Um **blaster** (Smart IR) não tem estado próprio: ele **captura** códigos IR
  do controle físico (modo estudo) e os **reemite** depois.
- Os códigos capturados (base64) ficam em **`ir-codes-local.json`**, agrupados
  por *device lógico* (`fita-led`, `tv`) e tecla (`on`, `power`, `vol+`...).
- Os blasters ficam em **`ir-local.json`** (gitignored):

```json
{
  "blasters": {
    "porao":  { "id": "...", "key": "...", "ip": "192.168.1.3",  "version": "3.3" },
    "quarto": { "id": "...", "key": "...", "ip": "192.168.1.15", "version": "3.5" }
  }
}
```

| Blaster | Aparelho controlado | Device lógico | Protocolo | Observação |
|---------|--------------------|---------------|-----------|------------|
| `porao` | Fita de LED | `fita-led` | 3.3 | faz broadcast (IP se auto-corrige) |
| `quarto` | TV | `tv` | **3.5** | **não** faz broadcast (IP precisa estar certo) |

## Protocolo local (o "como funciona")

- **DP 201** = comandos (JSON string): entrar/sair do modo estudo e enviar código.
- **DP 202** = código aprendido (chega como evento `data`/`dp-refresh`).
- Entrar em estudo: `{"control":"study"}` · Sair: `{"control":"study_exit"}`
- Enviar código: `{"control":"send_ir","head":"","key1":"1"+codigo,"type":0,"delay":300}`
  (o prefixo `"1"` antes do base64 é obrigatório)

Peculiaridades **obrigatórias** no código (já implementadas em `irLocal.js`):

1. `issueGetOnConnect: false` e `issueRefreshOnConnect: false` — blaster IR
   **não responde** consulta de status; sem isso o tuyapi estoura
   "Timeout waiting for status response".
2. Todo `set()` com `shouldWaitForResponse: false` — comandos IR não têm eco.
3. **Re-armar o estudo** a cada ~5s durante o aprendizado (e reconectar se
   cair) — o blaster sai do modo estudo sozinho e derruba conexões ociosas.
4. **Rejeitar capturas curtas** (< 40 chars): códigos reais têm ~190+ chars;
   fragmentos de 12 chars são ruído (já aconteceu com `brilho+`).
5. Se o connect falhar com IP fixo, **limpar `device.device.ip = undefined` e
   chamar `find()`** — o `find()` do tuyapi NÃO sobrescreve um IP já definido.
   (Só funciona em blaster que faz broadcast — o do porão sim, o do quarto não.)

## Como gravar botões (aprendizado)

**Método preferido — terminal** (processo dedicado, mais confiável):

```bash
# 1. PARE o `npm run dev` (o blaster aceita SÓ 1 conexão TCP; se o servidor
#    estiver conectado, os dois se derrubam e nada é capturado)

# 2. Grave cada tecla:  node scripts/ir-learn.js <tecla> [blaster] [device]
node scripts/ir-learn.js on                    # fita (porao/fita-led é padrão)
node scripts/ir-learn.js vermelho
node scripts/ir-learn.js "brilho+"
node scripts/ir-learn.js power quarto tv       # TV pelo blaster do quarto
node scripts/ir-learn.js "canal+" quarto tv

# 3. Quando aparecer ">>> APRENDENDO <<<", aponte o controle físico para o
#    blaster (de perto) e aperte o botão com toque firme. Janela de 40s.
#    Fragmento curto é ignorado com aviso — aperte de novo.

# 4. Religue o `npm run dev`
```

**Método alternativo — pela interface:** aba Quarto (TV) tem o modo
"⦿ Gravar botões" (clica no botão do layout → aponta o controle → aperta);
fita usa a aba Configuração. Usa o mesmo mecanismo por baixo (server →
`irLocal.js`), com as mesmas proteções.

**Nomes de tecla são contrato:** a UI só acende botões cujas teclas existem em
`ir-codes-local.json` com o nome exato. As listas canônicas estão em
`src/lib/useIrLocal.js`:
- `LED_KEYS` (fita): `on, off, vermelho, verde, azul, modo1, brilho+, brilho-`
- `TV_KEYS` (TV): `power, vol+, vol-, canal+, canal-, dvd` (power liga E desliga)
- `IRLAMP_KEYS` (lâmpada IR, blaster quarto, device `lampada-ir`): `on, off, brilho+, brilho-, vermelho, branco, azul, smooth`

Para **adicionar um botão novo**: inclua na lista correspondente em
`useIrLocal.js` (a UI de controle e de gravação derivam dela) e grave a tecla
com o mesmo nome.

## Scripts de apoio

| Comando | Para quê |
|---------|----------|
| `node scripts/ir-learn.js <tecla> [blaster] [device]` | grava um botão |
| `npm run ir:learn:on` / `ir:learn:off` | atalhos p/ fita |
| `npm run ir:debug [-- <blaster>]` | loga TUDO que o blaster envia por 35s (diagnóstico de captura) |
| `npm run ir:scan [-- <blaster>]` | procura o blaster na rede por broadcast |

## Local keys (quando param de funcionar)

A **openapi da Tuya está bloqueada** (IoT Core expirado). Local keys saem do
wizard, que usa a API do app e dribla o bloqueio:

```bash
npx @tuyapi/cli wizard   # credenciais já salvas; informe qualquer virtual ID
```

⚠️ **Resetar/re-parear um aparelho gera local key NOVA** (e pode mudar a versão
do protocolo!). Depois de reset: rodar o wizard, atualizar `ir-local.json`
(key e, se preciso, `version`) e conferir o IP.

## Troubleshooting (sintoma → causa → ação)

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Conecta e **cai ~1s após qualquer comando** | `version` errada no `ir-local.json` (ou key errada) | Testar connect com 3.4/3.5 (handshake valida a key); ajustar `version`. O quarto virou 3.5 após re-parear |
| "○ Procurando o Smart IR..." sem sair | IP mudou (DHCP) | `arp -a` após ping sweep procurando o MAC; atualizar `ip` no json. Ideal: reserva DHCP no roteador |
| "Nenhum código capturado" com dev rodando | Disputa pela única conexão TCP | Parar `npm run dev` e usar o script de terminal |
| Botão gravado mas não funciona / código com ~12 chars | Fragmento de captura (ruído) | Apagar a tecla e regravar (proteção < 40 chars já ignora automaticamente) |
| `find() timed out` no scan | Blaster não faz broadcast (quarto) ou está noutra sub-rede | Conectar por IP fixo; conferir rede/isolamento de AP |
| "Timeout waiting for status response" | Alguém reativou consulta de status | Manter `issueGetOnConnect/issueRefreshOnConnect: false` e `shouldWaitForResponse: false` |

## Arquivos do subsistema IR

| Arquivo | Papel |
|---------|-------|
| `irLocal.js` | driver do blaster (conexão, estudo, envio, auto-IP) |
| `server.js` (seção "Smart IR LOCAL") | endpoints `/api/ir-local/*` (status/learn/send/blink/stop), multi-blaster |
| `ir-local.json` | credenciais/IP dos blasters (**gitignored**) |
| `ir-codes-local.json` | códigos gravados (**gitignored** — faça backup!) |
| `scripts/ir-learn.js`, `ir-debug.js`, `ir-scan.js` | gravação e diagnóstico |
| `src/lib/useIrLocal.js` | hook de status + listas de teclas (`LED_KEYS`, `TV_KEYS`) |
| `src/lib/irLocalApi.js` | client HTTP do front |
| `src/components/TvRemote.jsx` | controle remoto da TV (aba Quarto) |
| `src/components/IrLampCard.jsx` | lâmpada IR do quarto (aba Quarto) |
| `src/components/LedControl/LedBlink/LedLearn.jsx` | fita de LED (abas Porão/Configuração) |
