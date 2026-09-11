import { PNG } from 'pngjs';
import fs from 'fs';
import { Bitmap } from '../raster.mjs';
const H = await import('../hero.mjs');
const all = H.allPoses();
const want = process.env.POSES ? process.env.POSES.split(',') : Object.keys(all);
const poses = want.map(n => [n, all[n]]).filter(p => p[1]);
const K = 5, cols = Math.min(14, poses.length), w = 24 * K, h = 30 * K;
const rowsN = Math.ceil(poses.length / cols);
const out = new PNG({ width: w * cols, height: h * rowsN });
for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 18; out.data[i+1] = 10; out.data[i+2] = 30; out.data[i+3] = 255; }
poses.forEach(([n, rows], i) => {
  const cx = (i % cols) * w, cy = Math.floor(i / cols) * h;
  const b = new Bitmap(24, 30); b.art(rows, H.PAL_HERO);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x / K) | 0, sy = (y / K) | 0;
    const s = (sy * 24 + sx) * 4;
    if (!b.data[s + 3]) continue;
    const d = ((cy + y) * w * cols + cx + x) * 4;
    out.data[d] = b.data[s]; out.data[d+1] = b.data[s+1]; out.data[d+2] = b.data[s+2]; out.data[d+3] = 255;
  }
});
fs.writeFileSync('/tmp/hero-pv.png', PNG.sync.write(out));
console.log('ok');
