/**
 * Синтез звуку у файли. Той самий процедурний звук, що був на WebAudio,
 * але прорахований один раз під час білду: Howler потім грає готовий
 * audio-sprite — на Android WebView це стабільніше, ніж будувати
 * осцилятори на кожен постріл.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'public', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const SR = 22050;

/* --------------------------------- примітиви синтезу --------------------------------- */
const env = (t, dur, atk = 0.008) =>
  t < atk ? t / atk : Math.max(0, Math.pow(1 - (t - atk) / (dur - atk), 1.6));
function osc(type, ph) {
  switch (type) {
    case 'square': return ph % 1 < 0.5 ? 1 : -1;
    case 'saw': return 2 * (ph % 1) - 1;
    case 'tri': return 4 * Math.abs((ph % 1) - 0.5) - 1;
    default: return Math.sin(ph * Math.PI * 2);
  }
}
let nseed = 12345;
const rnd = () => ((nseed = (nseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function tone(buf, t0, type, f0, f1, dur, vol) {
  let ph = 0;
  const n = Math.floor(dur * SR), i0 = Math.floor(t0 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = t / dur;
    const f = f0 * Math.pow(f1 / f0, k);
    ph += f / SR;
    const v = osc(type, ph) * env(t, dur) * vol;
    if (i0 + i < buf.length) buf[i0 + i] += v;
  }
}
function noise(buf, t0, dur, vol, f0, f1) {
  const n = Math.floor(dur * SR), i0 = Math.floor(t0 * SR);
  let lp = 0, bp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = t / dur;
    const f = (f0 * Math.pow((f1 || f0) / f0, k)) / SR;
    const x = rnd();
    lp += (x - lp) * Math.min(1, f * 6);
    bp = x - lp;
    const v = bp * env(t, dur) * vol;
    if (i0 + i < buf.length) buf[i0 + i] += v;
  }
}

/* --------------------------------- набір звуків --------------------------------- */
const SFX = {
  jump:      b => { tone(b, 0, 'square', 300, 620, 0.13, 0.30); },
  land:      b => { noise(b, 0, 0.06, 0.25, 400, 200); },
  dash:      b => { tone(b, 0, 'saw', 700, 160, 0.20, 0.24); noise(b, 0, 0.16, 0.18, 2400, 500); },
  slash0:    b => { noise(b, 0, 0.10, 0.34, 1800, 400); tone(b, 0, 'square', 900, 260, 0.10, 0.16); },
  slash1:    b => { noise(b, 0, 0.13, 0.34, 2300, 400); tone(b, 0, 'square', 780, 240, 0.10, 0.16); },
  slash2:    b => { noise(b, 0, 0.17, 0.40, 2800, 350); tone(b, 0, 'square', 660, 200, 0.13, 0.18); },
  shoot:     b => { tone(b, 0, 'saw', 900, 220, 0.09, 0.30); noise(b, 0, 0.05, 0.16, 3000, 1500); },
  beam:      b => { tone(b, 0, 'saw', 260, 1500, 0.28, 0.34); tone(b, 0, 'square', 130, 700, 0.30, 0.18); },
  charge:    b => { tone(b, 0, 'tri', 180, 900, 0.55, 0.16); },
  hit:       b => { noise(b, 0, 0.07, 0.34, 1200, 300); tone(b, 0, 'square', 480, 180, 0.07, 0.18); },
  hurt:      b => { tone(b, 0, 'saw', 300, 80, 0.28, 0.38); noise(b, 0, 0.20, 0.26, 700, 150); },
  parry:     b => { tone(b, 0, 'square', 1500, 2400, 0.07, 0.34); tone(b, 0.05, 'square', 2400, 1200, 0.14, 0.24); },
  discharge: b => { tone(b, 0, 'saw', 120, 40, 0.55, 0.40); noise(b, 0, 0.45, 0.34, 900, 120); },
  overheat:  b => { noise(b, 0, 0.55, 0.34, 6000, 1200); },
  reload:    b => { tone(b, 0, 'square', 800, 1600, 0.08, 0.30); tone(b, 0.07, 'square', 1600, 2100, 0.10, 0.22); },
  explode:   b => { noise(b, 0, 0.42, 0.44, 900, 80); tone(b, 0, 'saw', 160, 40, 0.4, 0.26); },
  pickup:    b => { tone(b, 0, 'square', 600, 900, 0.07, 0.24); tone(b, 0.07, 'square', 900, 1350, 0.09, 0.20); },
  checkpoint:b => { tone(b, 0, 'tri', 500, 750, 0.12, 0.24); tone(b, 0.11, 'tri', 750, 1130, 0.18, 0.20); },
  die:       b => { tone(b, 0, 'saw', 400, 50, 0.9, 0.38); noise(b, 0, 0.7, 0.22, 500, 100); },
  bossIn:    b => { tone(b, 0, 'saw', 70, 55, 1.3, 0.36); tone(b, 0.1, 'square', 140, 110, 1.1, 0.18);
                    noise(b, 0, 0.8, 0.22, 260, 90); },
  bossHurt:  b => { tone(b, 0, 'square', 240, 120, 0.14, 0.28); noise(b, 0, 0.12, 0.26, 800, 300); },
  bossDie:   b => { tone(b, 0, 'saw', 220, 30, 1.6, 0.42); noise(b, 0, 1.4, 0.30, 1200, 120);
                    tone(b, 0.2, 'square', 90, 40, 1.4, 0.24); },
  ui:        b => { tone(b, 0, 'square', 700, 900, 0.05, 0.20); },
  blocked:   b => { tone(b, 0, 'square', 200, 140, 0.10, 0.24); },
  win:       b => { [0, 4, 7, 12].forEach((s, i) =>
                    tone(b, i * 0.12, 'square', 440 * Math.pow(2, s / 12), 440 * Math.pow(2, s / 12), 0.18, 0.22)); }
};
const DUR = { jump:.2, land:.12, dash:.28, slash0:.18, slash1:.2, slash2:.26, shoot:.16, beam:.38,
  charge:.62, hit:.14, hurt:.36, parry:.24, discharge:.62, overheat:.62, reload:.22, explode:.5,
  pickup:.2, checkpoint:.34, die:1.0, bossIn:1.5, bossHurt:.22, bossDie:1.8, ui:.1, blocked:.16, win:.75 };

/* --------------------------------- складання спрайта --------------------------------- */
const GAP = 0.06;
let total = 0;
const sprite = {};
for (const k of Object.keys(SFX)) { sprite[k] = [Math.round(total * 1000), Math.round(DUR[k] * 1000)]; total += DUR[k] + GAP; }
const buf = new Float32Array(Math.ceil(total * SR) + SR);
for (const [k, fn] of Object.entries(SFX)) {
  const off = sprite[k][0] / 1000;
  const sub = new Float32Array(Math.ceil(DUR[k] * SR) + 8);
  fn(sub);
  for (let i = 0; i < sub.length; i++) buf[Math.floor(off * SR) + i] += sub[i];
}

function writeWav(file, data, sr = SR) {
  const n = data.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, data[i]));
    b.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}
writeWav(path.join(outDir, 'sfx.wav'), buf);
fs.writeFileSync(path.join(outDir, 'sfx.json'), JSON.stringify({ sprite }, null, 0));
// той самий мап як JS-модуль — щоб імпортувався і збіркою, і Node без прапорців
fs.writeFileSync(path.resolve(here, '..', 'src', 'sfx-sprite.js'),
  '/** Згенеровано tools/gen-audio.mjs — не редагувати руками. */\n' +
  'export const SFX_SPRITE = ' + JSON.stringify(sprite) + ';\n');

/* --------------------------------- музичні петлі --------------------------------- */
const MSR = 16000;
const TRACKS = {
  city:   { root: 55.0,  bpm: 104, arp: [0, 3, 7, 10], wave: 'square' },
  drive:  { root: 49.0,  bpm: 132, arp: [0, 3, 10, 7], wave: 'saw' },
  calm:   { root: 58.3,  bpm: 96,  arp: [0, 7, 12, 7], wave: 'tri' },
  boss:   { root: 41.2,  bpm: 150, arp: [0, 1, 7, 8],  wave: 'saw' }
};
for (const [name, t] of Object.entries(TRACKS)) {
  const beats = 32;                                   // 32 восьмих = рівно петля
  const spb = 60 / t.bpm / 2;
  const dur = beats * spb;
  const m = new Float32Array(Math.ceil(dur * MSR));
  const put = (t0, type, f, d, vol) => {
    let ph = 0;
    const n = Math.floor(d * MSR), i0 = Math.floor(t0 * MSR);
    for (let i = 0; i < n; i++) {
      ph += f / MSR;
      const k = i / n;
      const e = Math.min(1, k * 20) * Math.pow(1 - k, 1.4);
      const idx = (i0 + i) % m.length;
      m[idx] += osc(type, ph) * e * vol;
    }
  };
  for (let s = 0; s < beats; s++) {
    const bar = s % 16, t0 = s * spb;
    if (bar % 4 === 0) put(t0, 'tri', t.root, spb * 2.2, 0.34);
    if (bar % 2 === 0) put(t0, t.wave, t.root * 4 * Math.pow(2, t.arp[(s >> 1) % t.arp.length] / 12), spb * 1.1, 0.13);
    if (bar === 6 || bar === 14) put(t0, 'square', t.root * 8, spb * 0.5, 0.07);
  }
  writeWav(path.join(outDir, `music_${name}.wav`), m, MSR);
}
const sizes = fs.readdirSync(outDir).filter(f => f.endsWith('.wav'))
  .map(f => `${f} ${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)}КБ`);
console.log('звук:', Object.keys(SFX).length, 'ефектів у sfx.wav +', Object.keys(TRACKS).length, 'петель');
console.log('  ' + sizes.join(', '));
