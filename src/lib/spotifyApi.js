const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

const post = (path, body) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(json);

export const spotifyApi = {
  status: () => fetch('/api/spotify/status').then(json),

  // O login é uma navegação de verdade (o Spotify redireciona), não um fetch.
  // Vai direto na API (5858), não no vite (5757), porque o callback é lá.
  loginUrl: () => `${window.location.protocol}//${window.location.hostname}:5858/api/spotify/login`,

  logout: () => post('/api/spotify/logout'),

  saveConfig: (patch) => post('/api/spotify/config', patch),

  devices: () => fetch('/api/spotify/devices').then(json),

  // Fixa o destino: o grupo multi-cômodos das Alexas.
  setDevice: (id, name) => post('/api/spotify/device', { id, name }),

  transfer: (play) => post('/api/spotify/transfer', { play }),

  now: () => fetch('/api/spotify/now').then(json),

  playlists: () => fetch('/api/spotify/playlists').then(json),

  command: (action, value) => post('/api/spotify/command', { action, value }),

  next: () => spotifyApi.command('next'),
  previous: () => spotifyApi.command('previous'),
  toggle: () => spotifyApi.command('toggle'),
  volume: (v) => spotifyApi.command('volume', v),
  playContext: (uri) => spotifyApi.command('playlist', uri),
};
