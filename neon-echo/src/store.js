import { clamp } from './config.js';

/** Збереження прогресу й налаштувань. */
export const SAVE_KEY = 'echo_neon_courier_v1';
export const Store = {
  data: { unlocked: 1, cleared: [], vol: 7, mus: 5, vib: 1, size: 'M', hand: 0, op: 55,
          gfx: 'auto', crt: 0, deaths: 0 },
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
          d.vib = o.vib ? 1 : 0;
          d.size = (o.size === 'S' || o.size === 'L') ? o.size : 'M';
          d.op = clamp(parseInt(o.op, 10) || 55, 30, 90);
          d.gfx = ['perf', 'bal', 'max', 'auto'].indexOf(o.gfx) >= 0 ? o.gfx : 'auto';
          d.crt = o.crt ? 1 : 0;
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
    this.data.unlocked = 1; this.data.cleared = []; this.data.deaths = 0; this.save();
  }
};
