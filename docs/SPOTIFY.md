# Spotify + Cenas

Controla o Spotify que já toca nas duas Alexas da sala e junta isso com luz e TV
num botão só (aba **Música**).

## Como as duas Alexas viram um destino só

O sistema usa a **Spotify Web API** (Spotify Connect), a mesma coisa que o app do
celular usa quando você escolhe "Tocar em outro dispositivo".

Um Echo sozinho aparece como um device. As duas juntas só aparecem como **um
device** se existir um **grupo multi-cômodos** criado no app Alexa:

> App Alexa → Dispositivos → **+** → Adicionar grupo → **Grupo de multi-cômodos**
> → marque as duas Echo da sala → nome (ex.: `Sala`)

Depois disso o grupo `Sala` aparece na lista de caixas do Spotify. É esse device
que você salva na aba Música (botão **Procurar caixas** → clicar no grupo). Todo
comando do sistema passa a cair nas duas ao mesmo tempo.

Sem o grupo, dá para salvar só uma das Echo — o comando vai só nela.

## Setup (uma vez)

1. **Criar o app**: entre em <https://developer.spotify.com/dashboard> → *Create app*.
   - Redirect URI: `http://127.0.0.1:5858/api/spotify/callback`
     (tem que ser **127.0.0.1**, não `localhost` — o Spotify recusa; e igualzinho,
     incluindo a porta. Se você roda a API em outra porta, ajuste os dois lados
     ou defina `SPOTIFY_REDIRECT_URI`.)
   - Em *APIs used*, marque **Web API**.
2. **Colar as credenciais**: aba **Configuração** → card Spotify → Client ID e
   Client Secret → *Salvar credenciais*.
3. **Conectar a conta**: mesmo card → *Conectar com Spotify* → autorizar. Volta
   uma página dizendo "Spotify conectado".
4. **Escolher o destino**: aba **Música** → *Procurar caixas* → clicar no grupo
   das Alexas. Fica salvo como padrão.

Requer **Spotify Premium** — a API de playback não funciona em conta free.

Tudo fica em `spotify-config.json` (gitignored). Alternativa às credenciais na
UI: variáveis de ambiente `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`.

## Cenas

Cada cena é uma lista de passos executados em ordem, definida em `scenes.json`.
Um passo que falha **não** aborta os outros — a UI mostra ✓/✗ passo a passo.

A cena que já vem pronta é a **Modo filme**: próxima música → apaga as lâmpadas
do quarto → liga a TV pelo Smart IR.

```json
{
  "id": "modo-filme",
  "name": "Modo filme",
  "icon": "🎬",
  "description": "Troca a música, apaga as luzes do quarto e liga a TV.",
  "steps": [
    { "type": "spotify", "action": "next" },
    { "type": "lamp", "match": "quarto", "on": false },
    { "type": "wait", "ms": 400 },
    { "type": "ir", "blaster": "quarto", "device": "tv", "key": "power" }
  ]
}
```

### Passos disponíveis

| Passo | Campos | O que faz |
| --- | --- | --- |
| `spotify` | `action`, `value?` | `next`, `previous`, `play`, `pause`, `toggle`, `shuffle`, `volume` (0-100), `playlist` (`value` = `spotify:playlist:...`), `seek` |
| `lamp` | `match` ou `id`, `on` | `match` é regex no nome de `devices.json` — `"quarto"` pega entrada **e** saída |
| `ir` | `blaster`, `device`, `key` | Manda um código já aprendido (ver [INFRAVERMELHO.md](INFRAVERMELHO.md)) |
| `sound` | `file` | Toca um arquivo de `sounds/` nas caixas configuradas |
| `wait` | `ms` | Pausa entre passos (máx. 10s) |

### Detalhes que mordem

- **O `power` da TV é toggle**: o mesmo código liga e desliga. A cena "Modo filme"
  liga a TV se ela estiver desligada — e desliga se já estiver ligada. É limitação
  do controle IR, que não tem código separado de liga/desliga.
- **Volume nas Echo**: o Spotify normalmente recusa mudar volume de device Echo
  (`VOLUME_CONTROL_DISALLOWED`). Nesse caso o sistema avisa e a saída é usar
  "Alexa, volume 5".
- **Device sumido**: Echo ociosa some da lista de devices do Spotify. Se um
  comando falhar com "nenhum device ativo", o servidor tenta acordar o device
  salvo sozinho e repete o comando uma vez. Se ainda assim não achar, peça
  "Alexa, tocar Spotify" uma vez para ela reaparecer.

## Endpoints

```
GET  /api/spotify/status              estado da configuração e do login
POST /api/spotify/config              { clientId?, clientSecret?, playlists? }
GET  /api/spotify/login               redireciona pro OAuth do Spotify
GET  /api/spotify/callback            retorno do OAuth (salva o refresh_token)
POST /api/spotify/logout              esquece o refresh_token
GET  /api/spotify/devices             devices do Spotify Connect
POST /api/spotify/device              { id, name } fixa o destino padrão
POST /api/spotify/transfer            { play } joga o playback pro destino
GET  /api/spotify/now                 o que está tocando
GET  /api/spotify/playlists           suas playlists (para montar atalhos)
POST /api/spotify/command             { action, value }

GET  /api/scenes                      lista as cenas
POST /api/scenes/:id/run              executa uma cena
PUT  /api/scenes                      { scenes: [...] } regrava scenes.json
```

Como são endpoints HTTP simples, dá para amarrar uma cena num botão físico,
atalho do celular ou rotina da Alexa que chame o servidor:

```
curl -X POST http://localhost:5858/api/scenes/modo-filme/run
```
