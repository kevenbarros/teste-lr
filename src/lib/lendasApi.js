// Cliente do endpoint local /api/lendas/* (integração com a financas-lendas).
async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha na requisição');
  return data;
}

export const lendasApi = {
  status: () => fetch('/api/lendas/status').then(json),
  teams: () => fetch('/api/lendas/teams').then(json).then((d) => d.teams || []),
  saveRanking: (payload) =>
    fetch('/api/lendas/ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json),
};
