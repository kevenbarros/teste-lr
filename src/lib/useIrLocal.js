import { useCallback, useEffect, useState } from 'react';
import { irLocalApi } from './irLocalApi.js';

// Blasters (Smart IR físicos) e devices lógicos (agrupam os códigos aprendidos).
export const BLASTER_PORAO = 'porao';
export const BLASTER_QUARTO = 'quarto';
export const IR_DEVICE = 'fita-led';           // fita de LED (blaster porão)
export const IR_DEVICE_NAME = 'Fita de LED porão';
export const TV_DEVICE = 'tv';                 // TV (blaster quarto)
export const TV_DEVICE_NAME = 'TV Quarto';

// Botões da fita além de on/off: cores, modo e brilho. Usado no controle
// (Porão) e no aprendizado (Configuração) para não divergirem.
export const LED_KEYS = [
  { key: 'vermelho', label: 'Vermelho', className: 'red' },
  { key: 'verde',    label: 'Verde',    className: 'green' },
  { key: 'azul',     label: 'Azul',     className: 'blue' },
  { key: 'modo1',    label: 'Modo 1',   className: 'mode' },
  { key: 'brilho+',  label: '☀ Brilho +', className: 'bright' },
  { key: 'brilho-',  label: '🔅 Brilho −', className: 'bright' },
];

// Status de um Smart IR, revalidado a cada 4s. Um hook por blaster.
export function useIrLocal(blaster = BLASTER_PORAO) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await irLocalApi.status(blaster));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [blaster]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  return { info, error, refresh };
}
