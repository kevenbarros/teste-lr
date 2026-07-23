const json = (r) => r.json().then((data) => {
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
});

export const scenesApi = {
  list: () => fetch('/api/scenes').then(json),

  // Devolve { ok, scene, results:[{ label, ok, error }] } — passos podem falhar
  // sozinhos, então a UI mostra o que deu certo em vez de só "erro".
  run: (id) => fetch(`/api/scenes/${encodeURIComponent(id)}/run`, { method: 'POST' }).then(json),

  save: (scenes) =>
    fetch('/api/scenes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes }),
    }).then(json),
};
