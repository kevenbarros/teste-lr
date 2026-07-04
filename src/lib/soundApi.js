const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

export const soundApi = {
  list: () => fetch('/api/sound/list').then(json),

  play: (file, volume, loop) =>
    fetch('/api/sound/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, volume, loop }),
    }).then(json),

  stop: () => fetch('/api/sound/stop', { method: 'POST' }).then(json),

  volume: (volume) =>
    fetch('/api/sound/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    }).then(json),

  devices: () => fetch('/api/sound/devices').then(json),

  setDevice: (device) =>
    fetch('/api/sound/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
    }).then(json),
};
