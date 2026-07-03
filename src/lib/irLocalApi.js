const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

export const irLocalApi = {
  status: () => fetch('/api/ir-local/status').then(json),

  learn: (device, deviceName, key) =>
    fetch('/api/ir-local/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, deviceName, key }),
    }).then(json),

  send: (device, key) =>
    fetch('/api/ir-local/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, key }),
    }).then(json),

  blink: (device, intervalMs) =>
    fetch('/api/ir-local/blink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, intervalMs }),
    }).then(json),

  stop: () =>
    fetch('/api/ir-local/stop', { method: 'POST' }).then(json),

  forget: (device, key) =>
    fetch(`/api/ir-local/codes/${encodeURIComponent(device)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }).then(json),
};
