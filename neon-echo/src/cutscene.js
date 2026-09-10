/**
 * Катсцени: сценарій — це масив кроків, які програються один за одним.
 * Модуль нічого не малює сам: він тримає стан, а render/index.js читає
 * `Cut.view()` і виводить рамку, портрет, репліку й підказку «Тап —
 * пропустити». Гра на час катсцени стоїть, ввід заблоковано, музика
 * приглушена, керування сховане.
 *
 * Крок — це об'єкт з одним «дієсловом»:
 *   { say:'…', by:'ЕХО', p:'p_echo', t:2.6, anim:'slide' }  репліка з портретом
 *   { p:'p_servotaur', anim:'rise', t:0.8 }                      лише показати портрет
 *   { cam:{ dx, dy }, t:1.0 }                               наїзд камери (відносно)
 *   { wait:0.6 }                                            пауза
 *   { shake:5 }                                             тряска екрана
 *   { music:{ track:'boss2', layer:3, duck:2.0, sting:'boss' } }
 *   { flash:0.35 }                                          спалах
 *   { fade:'out', t:0.5 } / { fade:'in', t:0.5 }             затемнення
 *   { sfx:'bossIn' }                                        звук
 *
 * Анімації появи портрета (`anim`): 'slide' — виїжджає збоку,
 * 'rise' — піднімається знизу, 'glitch' — збирається з перешкод,
 * 'fade' — просто проявляється.
 */
import { Store } from './store.js';

const DEF_LINE = 2.8;                               // скільки висить репліка без t

export const Cut = {
  on: false,
  id: '',
  steps: [], i: 0, t: 0, stepT: 0,
  say: '', by: '', portrait: '', anim: 'fade', animT: 0,
  flash: 0, fade: 0, fadeDir: 0,
  cam: null, camFrom: null, done: null,
  hintT: 0,

  /** Чи бачив гравець цю катсцену раніше (щоб не змушувати дивитись двічі). */
  seen(id) {
    const s = Store.data.seenCuts || (Store.data.seenCuts = []);
    return s.indexOf(id) >= 0;
  },
  markSeen(id) {
    const s = Store.data.seenCuts || (Store.data.seenCuts = []);
    if (s.indexOf(id) < 0) { s.push(id); Store.save(); }
  },

  /**
   * Запустити сценарій. `onDone` викликається завжди — і після повного
   * перегляду, і після пропуску, тож гра ніколи не зависає.
   * Уже баченy катсцену пропускаємо одразу: другий перегляд не обов'язковий.
   */
  play(script, onDone) {
    const cb = onDone || (() => { });
    if (!script || !script.steps || !script.steps.length) { cb(); return false; }
    if (script.id && this.seen(script.id) && !Store.data.cutAlways) { cb(); return false; }
    this.on = true;
    this.id = script.id || '';
    this.steps = script.steps;
    this.i = -1; this.t = 0; this.stepT = 0;
    this.say = ''; this.by = ''; this.portrait = ''; this.anim = 'fade'; this.animT = 0;
    this.flash = 0; this.fade = 0; this.fadeDir = 0;
    this.cam = null; this.camFrom = null;
    this.hintT = 3.0;                               // підказка «Тап — пропустити»
    this.done = cb;
    this.next();
    return true;
  },

  /** Один тап у будь-який момент — і катсцена закінчується. */
  skip() {
    if (!this.on) return;
    this.finish();
  },

  finish() {
    if (!this.on) return;
    this.on = false;
    if (this.id) this.markSeen(this.id);
    this.say = ''; this.portrait = ''; this.flash = 0; this.fade = 0;
    const cb = this.done; this.done = null;
    if (cb) cb();
  },

  next() {
    this.i++;
    if (this.i >= this.steps.length) { this.finish(); return; }
    const s = this.steps[this.i];
    this.stepT = 0;
    this.t = s.t !== undefined ? s.t : (s.say !== undefined ? DEF_LINE : 0);

    if (s.p !== undefined) {                        // портрет + анімація появи
      if (s.p !== this.portrait) { this.portrait = s.p; this.animT = 0; }
      this.anim = s.anim || 'fade';
      if (s.anim) this.animT = 0;
    }
    if (s.say !== undefined) { this.say = s.say; this.by = s.by || this.by; }
    if (s.shake !== undefined && this.hooks.shake) this.hooks.shake(s.shake);
    if (s.sfx && this.hooks.sfx) this.hooks.sfx(s.sfx);
    if (s.music && this.hooks.music) this.hooks.music(s.music);
    if (s.flash !== undefined) this.flash = s.flash;
    if (s.fade) { this.fadeDir = s.fade === 'out' ? 1 : -1; if (this.t <= 0) this.t = 0.5; }
    if (s.cam) {
      const f = this.hooks.camGet ? this.hooks.camGet() : { x: 0, y: 0 };
      this.camFrom = f;
      // Абсолютні координати мали б знати розмір арени, тож сценарій
      // пише зсув: { dx, dy } від того, де камера стоїть зараз.
      this.cam = { x: s.cam.x !== undefined ? s.cam.x : f.x + (s.cam.dx || 0),
                   y: s.cam.y !== undefined ? s.cam.y : f.y + (s.cam.dy || 0) };
      if (this.t <= 0) this.t = 0.8;
    }
    if (this.t <= 0) this.next();                   // крок-миттєвість
  },

  step(dt) {
    if (!this.on) return;
    this.stepT += dt;
    this.animT += dt;
    if (this.hintT > 0) this.hintT -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.fadeDir) {
      const k = Math.min(1, this.stepT / Math.max(0.01, this.t));
      this.fade = this.fadeDir > 0 ? k : 1 - k;
    }
    if (this.cam && this.hooks.camSet) {
      const k = Math.min(1, this.stepT / Math.max(0.01, this.t));
      const e = k * k * (3 - 2 * k);                // згладжування на кінцях
      const f = this.camFrom || this.cam;
      this.hooks.camSet(f.x + (this.cam.x - f.x) * e, f.y + (this.cam.y - f.y) * e);
    }
    this.t -= dt;
    if (this.t <= 0) {
      if (this.fadeDir < 0) this.fade = 0;
      this.fadeDir = 0; this.cam = null;
      this.next();
    }
  },

  /** Усе, що потрібно рендеру, одним об'єктом (без алокацій щокадру). */
  _v: { on: false, say: '', by: '', portrait: '', anim: 'fade', animT: 0,
        flash: 0, fade: 0, hint: 0 },
  view() {
    const v = this._v;
    v.on = this.on; v.say = this.say; v.by = this.by;
    v.portrait = this.portrait; v.anim = this.anim; v.animT = this.animT;
    v.flash = this.flash; v.fade = this.fade; v.hint = this.hintT > 0 ? 1 : 0.55;
    return v;
  },

  // Зовнішні дії, які катсцена не вміє робити сама. Проставляє main.js.
  hooks: { shake: null, sfx: null, music: null, camGet: null, camSet: null }
};

/* ------------------------------------------------------------ СЦЕНАРІЇ
   Ключ — «коли:що». Тригери: 'pre' — перед боєм з босом, 'post' —
   після його смерті, 'lvl' — на початку рівня. Номер — індекс рівня. */
export const SCRIPTS = {
  /* --- ДЕМО: перед Сервотавром (сектор 2) --- */
  'pre:1': {
    id: 'pre-servotaur',
    steps: [
      { fade: 'out', t: 0.30 },
      { cam: { dx: 46 }, t: 0.7 },   // камера наїжджає на арену
      { fade: 'in', t: 0.35 },
      { p: 'p_echo', anim: 'slide', t: 0.5 },
      { say: 'Ворота доків. За ними — те, що доки ще ніхто не виносив.',
        by: 'ЕХО', p: 'p_echo', anim: 'slide', t: 2.9 },
      { music: { duck: 2.4 }, shake: 4, sfx: 'bossIn', t: 0.4 },
      { p: 'p_servotaur', anim: 'rise', t: 0.7 },
      { say: 'СЕРВОТАВР. ВАНТАЖ НЕ ПОКИДАЄ ПЕРИМЕТР.',
        by: 'СЕРВОТАВР', p: 'p_servotaur', anim: 'rise', t: 3.0 },
      { say: 'Я не вантаж. Я кур\'єр.', by: 'ЕХО', p: 'p_echo', anim: 'slide', t: 2.4 },
      { flash: 0.35, shake: 6, t: 0.35 },
      { say: 'ПОМИЛКА КЛАСИФІКАЦІЇ. ВИПРАВЛЯЮ.',
        by: 'СЕРВОТАВР', p: 'p_servotaur', anim: 'glitch', t: 2.6 },
      { fade: 'out', t: 0.4 }
    ]
  }
};

/** Сценарій для тригера або null. */
export function script(kind, level) {
  return SCRIPTS[kind + ':' + level] || null;
}
