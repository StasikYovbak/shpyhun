/**
 * САУНДТРЕК: synthwave / darksynth із chiptune-душею на Tone.js.
 *
 * Жодного mp3 — треки живуть у коді як трекерні патерни: масив кроків
 * на такт, де число — ступінь ладу, а null — пауза. Через це весь
 * саундтрек важить кілька кілобайт і вміє змінюватись на льоту.
 *
 * УСІ МЕЛОДІЇ ОРИГІНАЛЬНІ. Патерни написані з нуля під цю гру; жодних
 * цитат, семплів чи перегармонізацій чужих композицій.
 *
 * Чотири адаптивні шари:
 *   0  pad + bass                    — дослідження
 *   1  + drums                       — з'явився ворог
 *   2  + arp lead                    — бій
 *   3  + double-time drums & drive   — бос, фінальна фаза
 * Перемикання шарів чекає межі такту, тому не клацає.
 */
import { Store } from './store.js';

let Tone = null;                     // підвантажується в unlock(), не раніше

/* ------------------------------------------------------------ ЛАДИ */
// Півтони від тоніки. Кожен трек обирає свій — звідси різний характер.
const SCALES = {
  minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:   [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  hirajoshi:[0, 2, 3, 7, 8],            // японський лад для дуелі
  locrian:  [0, 1, 3, 5, 6, 8, 10],     // зламаний — для збою
  major:    [0, 2, 4, 5, 7, 9, 11]
};
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Ступінь ладу -> нота. Від'ємні й >7 працюють: переносяться октавами. */
function noteOf(root, scale, deg) {
  if (deg === null || deg === undefined) return null;
  const sc = SCALES[scale] || SCALES.minor;
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const semi = sc[((deg % n) + n) % n];
  const base = NAMES.indexOf(root.replace(/\d/, ''));
  const baseOct = parseInt(root.match(/\d/)[0], 10);
  const total = base + semi + (oct + baseOct) * 12;
  return NAMES[((total % 12) + 12) % 12] + Math.floor(total / 12);
}
const chord = (root, scale, deg, shape) => shape.map(o => noteOf(root, scale, deg + o));
const TRIAD = [0, 2, 4], SEVEN = [0, 2, 4, 6];

/* ------------------------------------------------------------ ТРЕКИ */
// «_» читається легше за null у довгих рядках патернів.
const _ = null;
const TRACKS = {
  /* меню: повільний дощ над містом */
  menu: { title: 'Neon Rain', bpm: 100, root: 'A2', scale: 'minor', bars: 4,
    pad:  [[0, TRIAD], [5, TRIAD], [3, SEVEN], [4, TRIAD]],
    bass: [0, _, _, 0, _, _, 7, _, 5, _, _, 5, _, _, 3, _,
           3, _, _, 3, _, _, 2, _, 4, _, _, 4, _, _, 4, 5],
    arp:  [7, 9, 11, 9, 7, 9, 11, 14, 12, 11, 9, 7, 9, 11, 12, 11],
    lead: [_, _, 14, _, 12, _, _, 11, _, _, 9, _, _, _, _, _,
           _, _, 11, _, 12, _, _, 14, _, _, 16, _, _, _, _, _],
    k: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    h: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] },

  /* сектори 1 і 3: вуличний драйв */
  rust: { title: 'Rust Sector', bpm: 118, root: 'A1', scale: 'minor', bars: 4,
    pad:  [[0, TRIAD], [3, TRIAD], [5, TRIAD], [4, SEVEN]],
    bass: [0, 0, _, 0, 7, _, 0, _, 0, 0, _, 3, _, 3, _, 2,
           3, 3, _, 3, 10, _, 3, _, 5, 5, _, 5, _, 4, _, 4],
    arp:  [7, 10, 12, 14, 12, 10, 7, 10, 9, 12, 14, 16, 14, 12, 9, 7],
    lead: [14, _, 12, _, 11, _, 12, _, 9, _, _, 7, _, _, _, _,
           11, _, 12, _, 14, _, 16, _, 14, _, _, 12, _, _, _, _],
    k: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    h: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1] },

  /* сектори 5 і 7: важкий індастріал */
  cargo: { title: 'Cold Cargo', bpm: 126, root: 'D2', scale: 'phrygian', bars: 4,
    pad:  [[0, TRIAD], [1, TRIAD], [0, TRIAD], [6, SEVEN]],
    bass: [0, _, 0, 0, _, 0, _, _, 1, _, 1, _, 0, _, _, 0,
           0, _, 0, 0, _, 0, _, _, 6, _, 6, _, 5, _, 4, _],
    arp:  [0, 3, 5, 3, 7, 5, 3, 5, 1, 3, 5, 7, 8, 7, 5, 3],
    lead: [_, _, _, _, 7, _, 8, _, 7, _, 5, _, _, _, _, _,
           _, _, _, _, 8, _, 7, _, 5, _, 3, _, _, _, _, _],
    k: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    h: [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1] },

  /* сектор 9: підйом на шпиль */
  ascent: { title: 'Ascent', bpm: 132, root: 'E2', scale: 'dorian', bars: 4,
    pad:  [[0, TRIAD], [4, TRIAD], [5, TRIAD], [6, SEVEN]],
    bass: [0, _, 0, _, 4, _, 0, _, 2, _, 2, _, 4, _, 2, _,
           4, _, 4, _, 7, _, 4, _, 5, _, 5, _, 6, _, 7, 8],
    arp:  [7, 9, 11, 14, 11, 9, 7, 9, 11, 14, 16, 18, 16, 14, 11, 9],
    lead: [_, 11, _, 12, _, 14, _, _, 16, _, _, 14, _, _, 12, _,
           _, 14, _, 16, _, 18, _, _, 19, _, _, _, _, _, _, _],
    k: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    h: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1] },

  /* бос 2: важкі удари в такт ривкам Сервотавра */
  bull: { title: 'Iron Bull', bpm: 140, root: 'C2', scale: 'minor', bars: 2,
    pad:  [[0, TRIAD], [5, TRIAD]],
    bass: [0, 0, 0, _, 0, 0, _, 0, 5, 5, 5, _, 3, _, 2, _],
    arp:  [0, 7, 12, 7, 0, 7, 12, 14, 3, 10, 15, 10, 2, 9, 14, 9],
    lead: [12, _, _, 11, _, _, 12, _, 14, _, _, _, 12, _, 11, _],
    k: [1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    h: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },

  /* бос 4: дзижчання вулика, нервові арпеджіо */
  hive: { title: 'Hive Static', bpm: 150, root: 'F2', scale: 'locrian', bars: 2,
    pad:  [[0, TRIAD], [4, TRIAD]],
    bass: [0, _, 0, 1, _, 0, _, 1, 0, _, 0, 4, _, 3, _, 1],
    arp:  [0, 1, 3, 1, 5, 3, 1, 3, 6, 5, 3, 5, 8, 6, 5, 3],
    lead: [_, 8, _, 7, _, 8, _, 10, _, 8, _, 7, _, 5, _, _],
    k: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
    s: [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0],
    h: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },

  /* бос 6: японський лад, напруга дуелі */
  blade: { title: 'Blade Memory', bpm: 145, root: 'A2', scale: 'hirajoshi', bars: 2,
    pad:  [[0, [0, 2, 4]], [3, [0, 2, 4]]],
    bass: [0, _, _, 0, _, _, 0, _, 3, _, _, 3, _, _, 2, _],
    arp:  [0, 2, 4, 5, 4, 2, 0, 2, 5, 7, 9, 7, 5, 4, 2, 0],
    lead: [_, _, 9, _, _, 7, _, _, 5, _, _, _, 4, _, _, _],
    k: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    h: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1] },

  /* бос 8: ламаний ритм і глітчі */
  corrupt: { title: 'Corrupted', bpm: 155, root: 'D2', scale: 'locrian', bars: 2,
    pad:  [[0, SEVEN], [1, SEVEN]],
    bass: [0, 0, _, 1, 0, _, 4, _, 0, _, 3, 0, _, 1, _, 6],
    arp:  [0, 6, 3, 8, 1, 7, 4, 9, 0, 5, 3, 8, 2, 6, 4, 10],
    lead: [_, _, 10, _, _, 8, _, 11, _, _, 7, _, 9, _, _, _],
    k: [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0],
    s: [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    h: [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1] },

  /* бос 10: три частини під три фази */
  arch: { title: 'The Architect', bpm: 160, root: 'C2', scale: 'minor', bars: 4,
    pad:  [[0, SEVEN], [5, SEVEN], [3, SEVEN], [6, SEVEN]],
    bass: [0, _, 0, _, 0, 0, _, 7, 5, _, 5, _, 5, 5, _, 3,
           3, _, 3, _, 3, 3, _, 10, 6, _, 6, _, 4, _, 2, _],
    arp:  [0, 4, 7, 12, 7, 4, 0, 4, 5, 9, 12, 16, 12, 9, 5, 9,
           3, 7, 10, 15, 10, 7, 3, 7, 6, 9, 13, 18, 13, 9, 6, 2],
    lead: [12, _, _, 14, _, 15, _, _, 14, _, 12, _, _, _, _, _,
           15, _, _, 17, _, 19, _, _, 17, _, 15, _, 14, _, 12, _],
    k: [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    h: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },

  /* фінал і титри: справжнє небо після десяти секторів темряви */
  sky: { title: 'Real Sky', bpm: 92, root: 'C3', scale: 'major', bars: 4,
    pad:  [[0, SEVEN], [3, SEVEN], [4, SEVEN], [0, SEVEN]],
    bass: [0, _, _, _, 4, _, _, _, 3, _, _, _, 2, _, _, _,
           4, _, _, _, 2, _, _, _, 0, _, _, _, 0, _, 4, _],
    arp:  [7, 9, 11, 12, 11, 9, 7, 9, 11, 12, 14, 12, 11, 9, 7, 4],
    lead: [_, _, 12, _, 11, _, 9, _, _, 7, _, _, 9, _, _, _,
           _, _, 11, _, 12, _, 14, _, _, 12, _, _, _, _, _, _],
    k: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    h: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] }
};
/** Тема локації або 'boss' -> трек. */
const TRACK_OF = {
  menu: 'menu', slum: 'rust', roofs: 'rust',
  docks: 'rust', factory: 'cargo', metro: 'cargo', server: 'cargo',
  garden: 'ascent', virtual: 'ascent', spire: 'ascent', core: 'arch',
  boss: 'bull', boss2: 'bull', boss4: 'hive', boss6: 'blade',
  boss8: 'corrupt', boss10: 'arch', win: 'sky'
};

/* --------------------------------------------------------- РУШІЙ */
let allowed = false;                 // до першого дотику контекст не чіпаємо
let built = false, running = false;
let pendTrack = null, pendStart = false;
let bus, comp, layer = [], synths = {}, seqs = [], stingBus;
let cur = null, curLevel = 0, wantLevel = 0, duckT = 0, barEvent = null, meterNode = null;
let lastSting = -9;

function build() {
  if (built || !allowed || !Tone) return;      // Tone.getContext() до жесту = попередження в консолі
  built = true;
  // шина музики: компресор -> гучність -> вихід
  bus = new Tone.Gain(0.0);
  comp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.006, release: 0.14 });
  const wide = new Tone.StereoWidener(0.7);
  bus.chain(comp, wide, Tone.getDestination());

  // по гейну на кожен шар — так перемикання чути як «додали інструмент»
  layer = [0, 1, 2, 3].map(() => new Tone.Gain(0).connect(bus));

  const rev = new Tone.Reverb({ decay: 3.4, wet: 0.28 }).connect(layer[0]);
  const dly = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.32, wet: 0.3 }).connect(layer[2]);
  const drive = new Tone.Distortion({ distortion: 0.35, wet: 0.0 }).connect(layer[3]);

  // pad: гейтований супер-соу
  synths.pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.7, release: 0.9 },
    volume: -22
  });
  synths.pad.maxPolyphony = 32;                   // 4 голоси × кілька тактів хвоста
  const gate = new Tone.Tremolo({ frequency: '8n', depth: 0.75, spread: 40 }).start();
  synths.pad.chain(gate, new Tone.Filter(2200, 'lowpass'), rev);

  // bass: пульсуюче арпеджіо-бас
  synths.bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { Q: 3, type: 'lowpass' },
    envelope: { attack: 0.004, decay: 0.16, sustain: 0.24, release: 0.1 },
    filterEnvelope: { attack: 0.004, decay: 0.12, sustain: 0.2, release: 0.1,
                      baseFrequency: 90, octaves: 3.2 },
    volume: -10
  }).connect(layer[0]);

  // arp: квадрат із chiptune-душею
  synths.arp = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.002, decay: 0.09, sustain: 0.0, release: 0.05 },
    filterEnvelope: { attack: 0.002, decay: 0.08, sustain: 0.1, release: 0.05,
                      baseFrequency: 700, octaves: 2.6 },
    volume: -20
  }).connect(dly);

  // lead: супер-соу
  synths.lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 4, spread: 40 },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.35, release: 0.5 },
    volume: -18
  });
  synths.lead.maxPolyphony = 24;
  synths.lead.chain(new Tone.Filter(3600, 'lowpass'), dly);

  // ударні: kick, шумовий снейр, закритий хет
  synths.kick = new Tone.MembraneSynth({
    pitchDecay: 0.035, octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0 }, volume: -6
  }).connect(layer[1]);
  synths.snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 }, volume: -16
  });
  synths.snare.chain(new Tone.Filter(1800, 'highpass'), layer[1]);
  synths.hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -30
  });
  synths.hat.chain(new Tone.Filter(7000, 'highpass'), layer[1]);
  // подвійний темп і драйв — тільки на четвертому шарі
  synths.kick2 = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 5,
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -10
  }).connect(drive);
  synths.drive = drive;

  // стінгери йдуть повз шари: їх має бути чути завжди
  stingBus = new Tone.Gain(0.9).connect(comp);
  synths.sting = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsquare', count: 2, spread: 20 },
    envelope: { attack: 0.004, decay: 0.22, sustain: 0.15, release: 0.4 },
    volume: -12
  }).connect(stingBus);
  synths.sting.maxPolyphony = 16;

  Tone.getTransport().bpm.value = 120;
  buildSeqs();
}

/**
 * Секвенції створюються ОДИН раз і живуть до кінця гри, читаючи дані
 * поточного треку. Раніше кожна зміна локації перестворювала їх — і на
 * швидких перемиканнях у PolySynth прилітало по дві ноти в один час
 * («Start time must be strictly greater», «Max polyphony exceeded»).
 * Тепер міняються лише дані й темп.
 */
const STEPS = 64;                    // чотири такти по 16 — вистачає всім трекам
let T = null;                        // поточний трек
function buildSeqs() {
  const note = d => (T ? noteOf(T.root, T.scale, d) : null);
  // Якщо головний потік підвис (завантаження рівня, збирання сміття),
  // планувальник Tone випускає всі прострочені події однією купою.
  // Прострочені пропускаємо: краще тиша на долю секунди, ніж десяток
  // акордів в одну мить і вичерпана поліфонія.
  const late = time => time < Tone.now() - 0.12;
  const seq = (fn) => {
    const q = new Tone.Sequence((time, i) => { if (T && !late(time)) fn(time, i, note); },
                                [...Array(STEPS).keys()], '16n');
    q.loop = true; q.start(0);
    seqs.push(q);
  };
  // pad: одна гармонія на такт
  seq((time, i) => {
    if (i % 16 !== 0) return;
    const c = T.pad[(i / 16) % T.pad.length];
    synths.pad.triggerAttackRelease(
      chord(T.root, T.scale, c[0], c[1]).map(n => Tone.Frequency(n).transpose(12)), '1n', time);
  });
  seq((time, i, note) => {
    const d = T.bass[i % T.bass.length];
    if (d === null) return;
    synths.bass.triggerAttackRelease(note(d), '16n', time);
  });
  seq((time, i, note) => {
    const d = T.arp[i % T.arp.length];
    if (d === null) return;
    synths.arp.triggerAttackRelease(Tone.Frequency(note(d)).transpose(12), '32n', time);
  });
  seq((time, i, note) => {
    const d = T.lead[i % T.lead.length];
    if (d === null) return;
    synths.lead.triggerAttackRelease(Tone.Frequency(note(d)).transpose(12), '8n', time, 0.7);
  });
  seq((time, i) => {
    const j = i % 16;
    if (T.k[j]) synths.kick.triggerAttackRelease('C1', '8n', time);
    if (T.s[j]) synths.snare.triggerAttackRelease('16n', time);
    if (T.h[j]) synths.hat.triggerAttackRelease('32n', time);
    if (curLevel >= 3 && j % 2 === 1) synths.kick2.triggerAttackRelease('C1', '32n', time + 0.001);
  });
}
/** Зміна треку — це зміна даних і темпу, без перестворення секвенцій. */
function loadTrack(id) {
  if (!TRACKS[id]) return;
  cur = id;
  T = TRACKS[id];
  try { synths.pad.releaseAll(); synths.lead.releaseAll(); } catch (e) { }
  Tone.getTransport().bpm.rampTo(T.bpm, 0.6);
}

/** Гучності шарів під поточний рівень інтенсивності. */
function applyLayers(t, at) {
  if (!built) return;
  const on = [1, 1, 1, 1].map((_, i) => (i <= curLevel ? 1 : 0));
  const tt = t === undefined ? 0.5 : t;
  // at — час із колбека Transport: без нього Tone лається, що подію
  // заплановано «зсередини запланованої події» без точного часу
  layer[0].gain.rampTo(on[0] ? 1 : 0, tt, at);
  layer[1].gain.rampTo(on[1] ? 0.9 : 0, tt, at);
  layer[2].gain.rampTo(on[2] ? 0.85 : 0, tt, at);
  layer[3].gain.rampTo(on[3] ? 0.8 : 0, tt, at);
  if (synths.drive) synths.drive.wet.rampTo(curLevel >= 3 ? 0.4 : 0, tt, at);
}

function musicVol() {
  const v = (Store.data.mus || 0) / 100;            // повзунок 0..100%
  return v * v * 0.85 * (duckT > 0 ? 0.75 : 1);     // ducking: -25%
}
function pushVol(t = 0.25) {
  if (!built) return;
  bus.gain.rampTo(running ? musicVol() : 0, t);
}

export const Music = {
  /** Контекст можна стартувати лише після дотику — інакше Android глушить. */
  async unlock() {
    if (allowed && built) return;
    try {
      Tone = await import('tone');     // сам модуль створює контекст — тому тільки тут
      await Tone.start();              // і лише коли контекст ПРАЦЮЄ, будуємо ланцюг
      allowed = true;
      build();
      if (pendTrack) { loadTrack(pendTrack); applyLayers(0.1); pendTrack = null; }
      if (pendStart) { pendStart = false; this.start(); }
    } catch (e) { allowed = built; }
  },
  /** Стан контексту — для налагодження й тестів. */
  ctxState() { try { return Tone ? Tone.getContext().state : 'none'; } catch (e) { return 'none'; } },
  transportState() { try { return Tone ? Tone.getTransport().state : 'none'; } catch (e) { return 'none'; } },
  /** theme: 'menu' | тема локації | 'boss' | 'boss4' ... | 'win' */
  set(theme) {
    const id = TRACK_OF[theme] || 'rust';
    if (!allowed || !Tone) { pendTrack = id; return; }
    build();
    if (id === cur) return;
    loadTrack(id);
    applyLayers(0.2);
  },
  start() {
    if (!allowed || !Tone) { pendStart = true; return; }
    build();
    // контекст іще прокидається — почекаємо, інакше Tone пише попередження
    if (Tone.getContext().state !== 'running') { pendStart = true; return; }
    running = true;
    const tr = Tone.getTransport();
    if (tr.state !== 'started') tr.start('+0.05');
    applyLayers(0.4);
    pushVol(0.4);
  },
  stop() {
    pendStart = false;
    if (!built) return;
    running = false;
    pushVol(0.3);
    setTimeout(() => { if (!running) { try { Tone.getTransport().pause(); } catch (e) { } } }, 340);
  },
  /**
   * Рівень інтенсивності 0..3. Зміна чекає межі такту — інакше новий
   * інструмент влітав би посеред долі й клацав. Застосовує її одна
   * повторювана подія на кожен такт, тож ніяка зміна не губиться,
   * скільки б їх не прийшло за один такт.
   */
  layer(n) {
    n = Math.max(0, Math.min(3, n | 0));
    if (!allowed || !Tone) { wantLevel = curLevel = n; return; }
    build();
    if (n === wantLevel) return;
    wantLevel = n;
    const tr = Tone.getTransport();
    // Transport може бути 'started', поки контекст іще suspended
    // (щойно після unlock або одразу після згортання) — тоді міняємо шар одразу.
    if (tr.state !== 'started' || Tone.getContext().state !== 'running') {
      curLevel = n; applyLayers(0.2); return;
    }
    if (barEvent === null) {
      barEvent = tr.scheduleRepeat((time) => {
        if (curLevel === wantLevel) return;
        curLevel = wantLevel;
        applyLayers(0.35, time);
      }, '1m', '@1m');
    }
  },
  /** Приглушити на час діалогу чи появи боса. */
  duck(sec = 2.2) { if (!built) return; duckT = Math.max(duckT, sec); pushVol(0.2); },
  setVol() { pushVol(0.2); },
  /** Короткі стінгери — теж написані тут, а не завантажені. */
  sting(kind) {
    if (!built) return;
    build();
    if (!Store.data.mus) return;
    const now = Tone.now();
    // Обмежувач: смерті й підбирання можуть іти чергою (перезапуск із
    // чекпоінта, кілька фрагментів поспіль). Без нього десяток стінгерів
    // накладається в одну мить і вичерпує поліфонію.
    if (now - lastSting < 0.35) return;
    lastSting = now;
    const s = synths.sting;
    const play = (ns, t, d = 0.14) => { try { s.triggerAttackRelease(ns, d, now + t, 0.8); } catch (e) { } };
    if (kind === 'boss')      { play(['C4', 'G4'], 0); play(['D#4', 'A#4'], 0.13); play(['G4', 'D5'], 0.26, 0.5); }
    else if (kind === 'die')  { play(['G3'], 0); play(['D#3'], 0.14); play(['B2'], 0.28); play(['G2'], 0.42, 0.7); }
    else if (kind === 'weapon') { play(['A4'], 0); play(['C#5'], 0.09); play(['E5'], 0.18); play(['A5'], 0.27, 0.45); }
    else if (kind === 'secret') { play(['E5'], 0); play(['B5'], 0.1); play(['E6'], 0.2, 0.5); }
  },
  update(dt) {
    if (duckT > 0) { duckT -= dt; if (duckT <= 0) pushVol(0.6); }
  },
  /** Для тестів і налагодження. */
  setTrack(id) { if (!built) return; build(); if (TRACKS[id] && id !== cur) { loadTrack(id); applyLayers(0.1); } },
  gains() { return built ? layer.map(l => l.gain.value) : [0, 0, 0, 0]; },
  busGain() { return built ? bus.gain.value : 0; },
  debugPoly() {
    if (!built) return null;
    return { padMax: synths.pad.maxPolyphony, padActive: synths.pad.activeVoices,
             leadMax: synths.lead.maxPolyphony, leadActive: synths.lead.activeVoices };
  },
  /** Рівень сигналу на шині — щоб тест бачив, що музика реально звучить. */
  meter() {
    if (!built) return -Infinity;
    build();
    if (!meterNode) { meterNode = new Tone.Meter({ smoothing: 0.6 }); comp.connect(meterNode); }
    const v = meterNode.getValue();
    return typeof v === 'number' ? v : Math.max(v[0], v[1]);
  },
  get title() { return cur ? TRACKS[cur].title : ''; },
  get trackId() { return cur; },
  get intensity() { return curLevel; }
};
export { TRACKS, TRACK_OF, noteOf };
