const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

const post = (path, body) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json);

// "blaster" = qual Smart IR físico ("porao" = fita LED, "quarto" = TV). Padrão: porao.
export const irLocalApi = {
  status: (blaster = 'porao') =>
    fetch(`/api/ir-local/status?blaster=${encodeURIComponent(blaster)}`).then(json),

  learn: (device, deviceName, key, blaster = 'porao') =>
    post('/api/ir-local/learn', { device, deviceName, key, blaster }),

  send: (device, key, blaster = 'porao') =>
    post('/api/ir-local/send', { device, key, blaster }),

  blink: (device, intervalMs, blaster = 'porao') =>
    post('/api/ir-local/blink', { device, intervalMs, blaster }),

  stop: (blaster = 'porao') => post('/api/ir-local/stop', { blaster }),

  forget: (device, key) =>
    fetch(`/api/ir-local/codes/${encodeURIComponent(device)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }).then(json),
};
