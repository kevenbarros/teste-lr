const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(json);

export const talkApi = {
  status: () => fetch('/api/talk/status').then(json),

  // saídas de áudio + microfones detectados (para a aba Configuração)
  devices: () => fetch('/api/talk/devices').then(json),

  start: () => post('/api/talk/start'),
  stop: () => post('/api/talk/stop'),

  // caixas que recebem a voz (persiste; reinicia se estiver ao vivo)
  setOutputs: (outputs) => post('/api/talk/outputs', { outputs }),

  // microfone usado ('' = padrão do Windows)
  setMic: (mic) => post('/api/talk/mic', { mic }),

  // volume da CAIXA ao vivo; com device ajusta só aquela caixa
  volume: (volume, device) => post('/api/talk/volume', { volume, device }),
};
