/**
 * Мінімальний растеризатор для випікання ассетів у PNG.
 * Малює те саме, що раніше малювалося щокадру на Canvas2D, але один раз
 * під час білду — далі рендер працює з текстурами, а не з fillRect.
 */
export class Bitmap {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  static rgba(c) {
    if (Array.isArray(c)) return c;
    let s = c.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    const n = parseInt(s.slice(0, 6), 16);
    const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  blend(x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4, d = this.data;
    if (a >= 255) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    const k = a / 255, ik = 1 - k;
    const da = d[i + 3] / 255;
    const oa = k + da * ik;
    d[i] = (r * k + d[i] * da * ik) / oa;
    d[i + 1] = (g * k + d[i + 1] * da * ik) / oa;
    d[i + 2] = (b * k + d[i + 2] * da * ik) / oa;
    d[i + 3] = oa * 255;
  }
  /**
   * Прямокутник. Якщо у бітмапа виставлено `k` (масштаб персонажів),
   * координати множаться саме ПО КРАЯХ, а не по ширині — інакше між
   * сусідніми прямокутниками з'являлись би щілини в один піксель.
   */
  rect(x, y, w, h, col) {
    const k = this.k || 1;
    if (k !== 1) {
      const X = Math.round(x * k), Y = Math.round(y * k);
      const W = Math.max(1, Math.round((x + w) * k) - X);
      const H = Math.max(1, Math.round((y + h) * k) - Y);
      x = X; y = Y; w = W; h = H;
    }
    const [r, g, b, a] = Bitmap.rgba(col);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.blend(x + i, y + j, r, g, b, a);
  }
  // Піксель-арт із масиву рядків: символ -> колір палітри, '.' — прозоро.
  art(rows, pal, ox = 0, oy = 0) {
    for (let y = 0; y < rows.length; y++) {
      const line = rows[y];
      for (let x = 0; x < line.length; x++) {
        const col = pal[line[x]];
        if (!col) continue;
        const [r, g, b, a] = Bitmap.rgba(col);
        this.blend(ox + x, oy + y, r, g, b, a);
      }
    }
  }
  // Радіальний градієнт (для спрайтів світла й спалахів).
  radial(cx, cy, rad, col, pow = 1) {
    const kr = this.k || 1;
    if (kr !== 1) { cx *= kr; cy *= kr; rad *= kr; }
    const [r, g, b] = Bitmap.rgba(col);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, pow) * 255;
      this.blend(x, y, r, g, b, a);
    }
  }
  ring(cx, cy, rad, width, col) {
    const kg = this.k || 1;
    if (kg !== 1) { cx *= kg; cy *= kg; rad *= kg; width *= kg; }
    const [r, g, b] = Bitmap.rgba(col);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const t = 1 - Math.min(1, Math.abs(d - rad) / width);
      if (t <= 0) continue;
      this.blend(x, y, r, g, b, t * 255);
    }
  }
  ellipse(cx, cy, rx, ry, col) {
    const [r, g, b, a] = Bitmap.rgba(col);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      this.blend(x, y, r, g, b, a * (1 - d * 0.35));
    }
  }
  noise(seed = 1) {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4;
      this.data[i] = rnd() * 255; this.data[i + 1] = rnd() * 255;
      this.data[i + 2] = 128; this.data[i + 3] = 255;
    }
    // згладжуємо, щоб displacement не «шумів» різко
    const src = this.data.slice();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      for (let c = 0; c < 2; c++) {
        let sum = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = (x + dx + this.w) % this.w, yy = (y + dy + this.h) % this.h;
          sum += src[(yy * this.w + xx) * 4 + c]; n++;
        }
        this.data[(y * this.w + x) * 4 + c] = sum / n;
      }
    }
  }
  blitTo(dst, ox, oy) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4;
      const a = this.data[i + 3];
      if (!a) continue;
      const j = ((oy + y) * dst.w + (ox + x)) * 4;
      dst.data[j] = this.data[i]; dst.data[j + 1] = this.data[i + 1];
      dst.data[j + 2] = this.data[i + 2]; dst.data[j + 3] = a;
    }
  }
}

/** Проста «поличкова» упаковка спрайтів в один атлас. */
export function pack(items, maxW = 1024) {
  let x = 0, y = 0, shelf = 0;
  const frames = {};
  for (const it of items) {
    if (x + it.bmp.w + 1 > maxW) { x = 0; y += shelf + 1; shelf = 0; }
    frames[it.name] = { x, y, w: it.bmp.w, h: it.bmp.h };
    it.x = x; it.y = y;
    x += it.bmp.w + 1;
    shelf = Math.max(shelf, it.bmp.h);
  }
  const H = y + shelf + 1;
  const atlas = new Bitmap(maxW, Math.pow(2, Math.ceil(Math.log2(H))));
  for (const it of items) it.bmp.blitTo(atlas, it.x, it.y);
  return { atlas, frames };
}
