/**
 * Звук на Howler: один audio-sprite із 25 ефектів + чотири музичні петлі.
 * Усі семпли згенеровані процедурно (tools/gen-audio.mjs) — жодних
 * завантажених звідкись файлів.
 */
import { Howl, Howler } from 'howler';
import { Store } from './store.js';
import { SFX_SPRITE } from './sfx-sprite.js';
import { Music } from './music.js';

let sfx = null, ready = false;

export function initAudio() {
  if (ready) return;
  ready = true;
  Howler.autoUnlock = true;
  sfx = new Howl({
    src: ['assets/sfx.wav'],
    sprite: SFX_SPRITE,
    preload: true,
    html5: false
  });
  applyVolume();
}
export function applyVolume() {
  if (!ready) return;
  Howler.volume(1);
  if (sfx) sfx.volume(Store.data.vol / 100);       // повзунок 0..100%
  Music.setVol();
}
export function resumeAudio() {
  try { if (Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume(); } catch (e) { }
  Music.unlock();                                  // Tone.js стартує лише після дотику
}

function play(name) {
  if (!ready || !sfx || Store.data.vol <= 0) return;
  try { sfx.play(name); } catch (e) { }
}

/** Той самий інтерфейс, що був у версії 1.x — логіка гри не змінюється. */
export const Sfx = {
  get on() { return ready; },
  init: initAudio, resume: resumeAudio, setVol: applyVolume,
  jump: () => play('jump'), land: () => play('land'), dash: () => play('dash'),
  slash: i => play('slash' + Math.min(2, i | 0)),
  shoot: () => play('shoot'), beam: () => play('beam'), charge: () => play('charge'),
  hitEnemy: () => play('hit'), hurt: () => play('hurt'), parry: () => play('parry'),
  discharge: () => play('discharge'), overheat: () => play('overheat'), reload: () => play('reload'),
  explode: () => play('explode'), pickup: () => play('pickup'), checkpoint: () => play('checkpoint'),
  die: () => play('die'), bossIn: () => play('bossIn'), bossHurt: () => play('bossHurt'),
  bossDie: () => play('bossDie'), ui: () => play('ui'), win: () => play('win'),
  blocked: () => play('blocked'),
  // по звуку на кожну зброю
  wRail: () => play('wRail'), wOsa: () => play('wOsa'), wBrand: () => play('wBrand'),
  wSwarm: () => play('wSwarm'), wChrono: () => play('wChrono'), wClaws: () => play('wClaws'),
  wShot: () => play('wShot'), wGlitch: () => play('wGlitch'), wPrism: () => play('wPrism'),
  shell: () => play('shell')
};

export { Music };

/** Вібрація: на Android — через Capacitor Haptics, у браузері — navigator.vibrate. */
let haptics = null;
export function setHaptics(h) { haptics = h; }
const VIB_K = [0, 0.6, 1.4];                    // вимк. / слабка / сильна
export function buzz(ms) {
  const k = VIB_K[Store.data.vib] || 0;
  if (!k) return;
  const scale = v => Math.max(1, Math.round(v * k));
  const pat = Array.isArray(ms) ? ms.map(scale) : scale(ms);
  const dur = Array.isArray(pat) ? pat.reduce((a, b) => a + b, 0) : pat;
  if (haptics) { try { haptics(dur); return; } catch (e) { } }
  try { if (navigator.vibrate) navigator.vibrate(pat); } catch (e) { }
}
