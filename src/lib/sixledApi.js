export function buildSixledApi(ips) {
  const qs = `?ips=${encodeURIComponent(ips.join(','))}`;
  return {
    status: () => fetch(`/api/sixled/status${qs}`).then(r => r.json()),
    cmd: (n) => fetch(`/api/sixled/cmd/${n}${qs}`),
    par: (p, v) => fetch(`/api/sixled/par/${p}/${v}${qs}`),
    getConfig: () => fetch(`/api/sixled/config${qs}`).then(r => r.json()),
    saveConfig: (cfg) => fetch(`/api/sixled/config${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    }).then(r => r.json()),
  };
}
