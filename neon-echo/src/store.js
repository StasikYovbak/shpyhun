import { clamp, DEV_MODE } from './config.js';

/**
 * Збереження прогресу й налаштувань.
 *
 * У режимі розробника гра пише в ОКРЕМИЙ слот: чити, розблокована зброя
 * й стрибки по рівнях не чіпають основний прогрес гравця. Прапорець
 * `DEV_MODE` статичний, тож у релізі тут лишається просто рядок ключа.
 */
export const SAVE_KEY = DEV_MODE ? 'echo_neon_courier_v1_dev' : 'echo_neon_courier_v1';
export const SAVE_KEY_MAIN = 'echo_neon_courier_v1';
export const Store = {
  data: {
    unlocked: 1, cleared: [], deaths: 0, logs: [],
    vol: 70, mus: 50, vib: 1, gfx: 'auto', crt: 0, easy: 0,   // vib: 0 вимк / 1 слабка / 2 сильна
    // пост-обробка у відсотках; аберація за замовчуванням вимкнена
    bloom: 35, ab: 0, bgDim: 60, outline: 1, dbg: 0,
    // керування
    hand: 0, dpadOp: 55, btnOp: 55, dpadSize: 100, btnSize: 100,
    // камера: 0 = героїня в центрі, 1 = класична з випередженням
    cam: 0, dimFight: 1,
    dpadPos: null, btnPos: null, size: 'M', op: 55,
    // арсенал
    owned: ['arc', 'rail'], melee: 'arc', ranged: 'rail', freeSwap: 0,
    // нагороди й секрет
    frags: [], bonusHp: 0, ngKey: 0, ng: 0,
    // катсцени: які вже бачив (другий перегляд не обов'язковий)
    seenCuts: [], cutAlways: 0,
    // складність: easy / normal / hard. Міняється будь-коли, нічого не блокує.
    diff: 'normal',
    // навчання: чи питали й чи пройдено; які підказки вже показані
    tutAsked: 0, tutDone: 0, tutSeen: []
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          const d = this.data;
          d.unlocked = clamp(parseInt(o.unlocked, 10) || 1, 1, 10);
          d.cleared = Array.isArray(o.cleared) ? o.cleared.filter(n => typeof n === 'number') : [];
          // повзунки стали 0..100%; старі збереження (0..10) домножуємо
          const up = v => (v > 0 && v <= 10 ? v * 10 : v);
          d.vol = clamp(up(parseInt(o.vol, 10) >= 0 ? parseInt(o.vol, 10) : 70), 0, 100);
          d.mus = clamp(up(parseInt(o.mus, 10) >= 0 ? parseInt(o.mus, 10) : 50), 0, 100);
          d.vib = clamp(parseInt(o.vib, 10) >= 0 ? parseInt(o.vib, 10) : 1, 0, 2);
          d.size = (o.size === 'S' || o.size === 'L') ? o.size : 'M';
          d.op = clamp(parseInt(o.op, 10) || 55, 30, 90);
          d.gfx = ['perf', 'bal', 'max', 'auto'].indexOf(o.gfx) >= 0 ? o.gfx : 'auto';
          d.crt = o.crt ? 1 : 0;
          d.bloom = clamp(parseInt(o.bloom, 10) >= 0 ? parseInt(o.bloom, 10) : 35, 0, 100);
          d.ab = clamp(parseInt(o.ab, 10) >= 0 ? parseInt(o.ab, 10) : 0, 0, 100);
          d.bgDim = clamp(parseInt(o.bgDim, 10) >= 0 ? parseInt(o.bgDim, 10) : 60, 20, 100);
          d.outline = o.outline === undefined ? 1 : (o.outline ? 1 : 0);
          d.dbg = o.dbg ? 1 : 0;
          d.easy = o.easy ? 1 : 0;
          d.freeSwap = o.freeSwap ? 1 : 0;
          d.cam = o.cam ? 1 : 0;
          d.dimFight = o.dimFight === undefined ? 1 : (o.dimFight ? 1 : 0);
          d.dpadOp = clamp(parseInt(o.dpadOp, 10) || 55, 20, 100);
          d.btnOp = clamp(parseInt(o.btnOp, 10) || 55, 20, 100);
          d.dpadSize = clamp(parseInt(o.dpadSize, 10) || 100, 70, 160);
          d.btnSize = clamp(parseInt(o.btnSize, 10) || 100, 70, 160);
          d.dpadPos = (o.dpadPos && typeof o.dpadPos.x === 'number') ? o.dpadPos : null;
          d.btnPos = (o.btnPos && typeof o.btnPos.x === 'number') ? o.btnPos : null;
          d.logs = Array.isArray(o.logs) ? o.logs.filter(n => typeof n === 'number') : [];
          d.owned = Array.isArray(o.owned) && o.owned.length ? o.owned.slice() : ['arc', 'rail'];
          if (d.owned.indexOf('arc') < 0) d.owned.push('arc');
          if (d.owned.indexOf('rail') < 0) d.owned.push('rail');
          d.melee = d.owned.indexOf(o.melee) >= 0 ? o.melee : 'arc';
          d.ranged = d.owned.indexOf(o.ranged) >= 0 ? o.ranged : 'rail';
          d.frags = Array.isArray(o.frags) ? o.frags.filter(n => typeof n === 'number') : [];
          d.bonusHp = clamp(parseInt(o.bonusHp, 10) || 0, 0, 3);
          d.ngKey = o.ngKey ? 1 : 0;
          d.ng = o.ng ? 1 : 0;
          d.seenCuts = Array.isArray(o.seenCuts) ? o.seenCuts.filter(v => typeof v === 'string') : [];
          d.cutAlways = o.cutAlways ? 1 : 0;
          d.hand = o.hand ? 1 : 0;
          d.deaths = parseInt(o.deaths, 10) || 0;
          d.diff = ['easy', 'normal', 'hard'].indexOf(o.diff) >= 0 ? o.diff : 'normal';
          d.tutAsked = o.tutAsked ? 1 : 0;
          d.tutDone = o.tutDone ? 1 : 0;
          d.tutSeen = Array.isArray(o.tutSeen) ? o.tutSeen.filter(v => typeof v === 'string') : [];
        }
      }
    } catch (e) { /* приватний режим / вимкнене сховище — граємо без збереження */ }
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { }
  },
  clear() {
    // Стирається ПРОГРЕС. Налаштування, складність і розкладка керування
    // (вона й так в іншому ключі) лишаються: людина скидає проходження,
    // а не свою руку й свій екран.
    const d = this.data;
    d.unlocked = 1; d.cleared = []; d.deaths = 0; d.logs = [];
    d.owned = ['arc', 'rail']; d.melee = 'arc'; d.ranged = 'rail';
    d.frags = []; d.bonusHp = 0; d.ngKey = 0; d.ng = 0;
    d.seenCuts = []; d.tutDone = 0; d.tutAsked = 0; d.tutSeen = [];
    this.save();
  }
};
