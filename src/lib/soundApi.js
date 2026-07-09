const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

export const soundApi = {
  list: () => fetch('/api/sound/list').then(json),

  play: (file, loop) =>
    fetch('/api/sound/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, loop }),
    }).then(json),

  stop: () => fetch('/api/sound/stop', { method: 'POST' }).then(json),

  // volume da CAIXA ao vivo; com device ajusta só aquela caixa
  volume: (volume, device) =>
    fetch('/api/sound/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume, device }),
    }).then(json),

  // volume específico de um SOM (vale na próxima vez que tocar)
  soundVolume: (file, volume) =>
    fetch('/api/sound/sound-volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, volume }),
    }).then(json),

  devices: () => fetch('/api/sound/devices').then(json),

  setOutputs: (outputs) =>
    fetch('/api/sound/outputs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputs }),
    }).then(json),
};
