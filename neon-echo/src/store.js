import { clamp } from './config.js';

/** Збереження прогресу й налаштувань. */
export const SAVE_KEY = 'echo_neon_courier_v1';
export const Store = {
  data: {
    unlocked: 1, cleared: [], deaths: 0, logs: [],
    vol: 7, mus: 5, vib: 1, gfx: 'auto', crt: 0, easy: 0,   // vib: 0 вимк / 1 слабка / 2 сильна
    // керування
    hand: 0, dpadOp: 55, btnOp: 55, dpadSize: 100, btnSize: 100,
    dpadPos: null, btnPos: null, size: 'M', op: 55,
    // арсенал
    owned: ['arc', 'rail'], melee: 'arc', ranged: 'rail', freeSwap: 0
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
          d.vol = clamp(parseInt(o.vol, 10) >= 0 ? parseInt(o.vol, 10) : 7, 0, 10);
          d.mus = clamp(parseInt(o.mus, 10) >= 0 ? parseInt(o.mus, 10) : 5, 0, 10);
          d.vib = clamp(parseInt(o.vib, 10) >= 0 ? parseInt(o.vib, 10) : 1, 0, 2);
          d.size = (o.size === 'S' || o.size === 'L') ? o.size : 'M';
          d.op = clamp(parseInt(o.op, 10) || 55, 30, 90);
          d.gfx = ['perf', 'bal', 'max', 'auto'].indexOf(o.gfx) >= 0 ? o.gfx : 'auto';
          d.crt = o.crt ? 1 : 0;
          d.easy = o.easy ? 1 : 0;
          d.freeSwap = o.freeSwap ? 1 : 0;
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
          d.hand = o.hand ? 1 : 0;
          d.deaths = parseInt(o.deaths, 10) || 0;
        }
      }
    } catch (e) { /* приватний режим / вимкнене сховище — граємо без збереження */ }
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { }
  },
  clear() {
    const d = this.data;
    d.unlocked = 1; d.cleared = []; d.deaths = 0; d.logs = [];
    d.owned = ['arc', 'rail']; d.melee = 'arc'; d.ranged = 'rail';
    this.save();
  }
};
