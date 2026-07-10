import { useCallback, useEffect, useState } from 'react';
import { irLocalApi } from './irLocalApi.js';

// Blasters (Smart IR físicos) e devices lógicos (agrupam os códigos aprendidos).
export const BLASTER_PORAO = 'porao';
export const BLASTER_QUARTO = 'quarto';
export const IR_DEVICE = 'fita-led';           // fita de LED (blaster porão)
export const IR_DEVICE_NAME = 'Fita de LED porão';
export const TV_DEVICE = 'tv';                 // TV (blaster quarto)
export const TV_DEVICE_NAME = 'TV Quarto';

// Botões do controle da TV (aba Quarto). power liga E desliga (mesmo código).
export const TV_KEYS = [
  { key: 'power',  label: '⏻', name: 'Power (liga/desliga)' },
  { key: 'vol+',   label: '+', name: 'Volume +' },
  { key: 'vol-',   label: '−', name: 'Volume −' },
  { key: 'canal+', label: '+', name: 'Canal +' },
  { key: 'canal-', label: '−', name: 'Canal −' },
  { key: 'dvd',    label: 'DVD', name: 'DVD' },
];

// Lâmpada IR do quarto (blaster quarto): liga/desliga, brilho, cores e smooth.
export const IRLAMP_DEVICE = 'lampada-ir';
export const IRLAMP_DEVICE_NAME = 'Lâmpada IR quarto';
export const IRLAMP_KEYS = [
  { key: 'on',       label: 'Ligar',      className: 'on' },
  { key: 'off',      label: 'Desligar',   className: 'off' },
  { key: 'brilho+',  label: '☀ Brilho +', className: 'bright' },
  { key: 'brilho-',  label: '🔅 Brilho −', className: 'bright' },
  { key: 'vermelho', label: 'Vermelho',   className: 'red' },
  { key: 'branco',   label: 'Branco',     className: 'white' },
  { key: 'azul',     label: 'Azul',       className: 'blue' },
  { key: 'smooth',   label: 'Smooth',     className: 'mode' },
];

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
