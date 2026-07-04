// Gera sounds/beep.wav — um alerta curto "ding-ding-diiing".
// WAV PCM 16-bit mono 44100Hz. Começa com um trecho de silêncio (lead) para
// dar tempo do roteamento (svcl) mandar a sessão pra SoundCore 2 antes do tom.
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SR = 44100;
const LEAD_MS = 350; // silêncio inicial: janela para o svcl rotear a sessão

// Sequência de tons: [freqHz, duraçãoMs, gapMs depois]
const notes = [
  [784, 150, 60],   // Sol5
  [784, 150, 60],   // Sol5
  [1046, 300, 0],   // Dó6 (final mais longo)
];

const samples = [];
const pushSilence = (ms) => {
  const n = Math.round((ms / 1000) * SR);
  for (let i = 0; i < n; i++) samples.push(0);
};
const pushTone = (freq, ms) => {
  const n = Math.round((ms / 1000) * SR);
  const fade = Math.min(Math.round(0.008 * SR), Math.floor(n / 2)); // 8ms fade in/out (anti-click)
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > n - fade) env = (n - i) / fade;
    const s = Math.sin((2 * Math.PI * freq * i) / SR) * 0.6 * env;
    samples.push(s);
  }
};

pushSilence(LEAD_MS);
for (const [freq, dur, gap] of notes) {
  pushTone(freq, dur);
  if (gap) pushSilence(gap);
}

// PCM 16-bit
const data = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i++) {
  const v = Math.max(-1, Math.min(1, samples[i]));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}

// Cabeçalho WAV
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);       // tamanho do fmt
header.writeUInt16LE(1, 20);        // PCM
header.writeUInt16LE(1, 22);        // mono
header.writeUInt32LE(SR, 24);       // sample rate
header.writeUInt32LE(SR * 2, 28);   // byte rate
header.writeUInt16LE(2, 32);        // block align
header.writeUInt16LE(16, 34);       // bits por amostra
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const outDir = join(__dirname, '..', 'sounds');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'beep.wav');
writeFileSync(outPath, Buffer.concat([header, data]));
console.log('beep.wav gerado:', outPath, `(${(header.length + data.length)} bytes)`);
