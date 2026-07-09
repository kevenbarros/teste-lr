import { useCallback, useEffect, useState } from 'react';
import { lampsApi } from './lampsApi.js';

// Busca a lista de lâmpadas e revalida a cada 3s. Cada página filtra as que usa.
export function useLamps() {
  const [lamps, setLamps] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLamps(await lampsApi.list());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return { lamps, error, refresh };
}

// Acha uma lâmpada pelo nome (case-insensitive, por trecho/regex).
export function findLamp(lamps, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  return lamps.find((l) => re.test(l.name)) || null;
}
