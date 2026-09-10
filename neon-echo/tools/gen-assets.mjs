/**
 * Генератор ассетів. Запускається перед кожним білдом (npm run assets):
 * пече весь піксель-арт у ОДИН текстурний атлас assets/atlas.png + atlas.json,
 * шумову текстуру для displacement, іконки застосунку всіх щільностей і splash.
 * Жодних намальованих вручну PNG — усе відтворюється з коду.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { Bitmap, pack } from './raster.mjs';
import { HERO, PAL_HERO, PAL_PHANTOM } from './art.mjs';
import { THEME } from '../src/themes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const items = [];
const add = (name, bmp) => { items.push({ name, bmp }); return bmp; };
const make = (name, w, h, fn) => { const b = new Bitmap(w, h); fn(b); return add(name, b); };

/* ------------------------------------------------------------------ ГЕРОЙ */
for (const [k, rows] of Object.entries(HERO)) {
  make('hero_' + k, 12, 15, b => b.art(rows, PAL_HERO));
  make('phantom_' + k, 12, 15, b => b.art(rows, PAL_PHANTOM));
}

/* ---------------------------------------------------------------- ВОРОГИ */
// Палітри: [основа, світле, акцент]; елітні — золоті вставки.
const EPAL = {
  skreb:  { base: '#3f7a4a', lite: '#5fbf6a', dark: '#2a5233', eye: '#ff3355' },
  thug:   { base: '#5b3a2a', skin: '#f7c9a6', band: '#a02a4a', boot: '#2a1140' },
  turret: { base: '#4a5568', lite: '#69788f', dark: '#2a3140', lens: '#22e0ff' },
  wasp:   { base: '#c9a227', dark: '#2a1140', eye: '#ff3355' },
  kami:   { base: '#7a2a2a', core: '#ffd23f', hot: '#ff3355' },
  shield: { base: '#3a4a6a', skin: '#f7c9a6', plate: '#22e0ff' },
  adept:  { base: '#2f4a63', skin: '#f7c9a6', band: '#e0f7ff', hurt: '#6a3a5a' },
  spider: { base: '#5a3a7a', lite: '#a06ad0', eye: '#ff3355' }
};
const GOLD = '#ffd23f';

function enemySprite(type, elite) {
  const p = EPAL[type];
  const trim = elite ? GOLD : null;
  switch (type) {
    case 'skreb': return make(`e_skreb_${elite ? 'x' : 'n'}`, 12, 9, b => {
      b.rect(0, 2, 12, 7, p.base); b.rect(1, 0, 10, 3, trim || p.lite);
      b.rect(8, 3, 3, 2, p.eye); b.rect(1, 4, 10, 1, p.dark);
    });
    case 'thug': return make(`e_thug_${elite ? 'x' : 'n'}`, 12, 15, b => {
      b.rect(1, 4, 10, 11, p.base); b.rect(2, 0, 8, 5, p.skin);
      b.rect(2, 1, 8, 2, trim || p.band);
      b.rect(2, 11, 3, 4, p.boot); b.rect(7, 11, 3, 4, p.boot);
      b.rect(3, 6, 6, 3, '#00000033');
    });
    case 'turret': return make(`e_turret_${elite ? 'x' : 'n'}`, 14, 14, b => {
      b.rect(1, 4, 12, 10, p.base); b.rect(2, 2, 10, 4, p.lite);
      b.rect(4, 6, 6, 4, trim || p.lens); b.rect(1, 12, 12, 2, p.dark);
    });
    case 'wasp': return make(`e_wasp_${elite ? 'x' : 'n'}`, 12, 10, b => {
      b.rect(2, 3, 8, 5, trim || p.base); b.rect(3, 4, 6, 2, p.dark);
      b.rect(9, 7, 3, 3, p.eye); b.rect(2, 8, 8, 1, p.dark);
    });
    case 'kami': return make(`e_kami_${elite ? 'x' : 'n'}`, 11, 11, b => {
      b.rect(1, 1, 9, 9, p.base); b.rect(3, 3, 5, 5, trim || p.core);
      b.rect(0, 4, 1, 3, p.hot); b.rect(10, 4, 1, 3, p.hot);
    });
    case 'shield': return make(`e_shield_${elite ? 'x' : 'n'}`, 14, 16, b => {
      b.rect(2, 3, 10, 13, p.base); b.rect(3, 0, 8, 4, p.skin);
      b.rect(3, 1, 8, 1, trim || '#00000000');
      b.rect(4, 12, 3, 4, '#22203a'); b.rect(8, 12, 3, 4, '#22203a');
    });
    case 'adept': return make(`e_adept_${elite ? 'x' : 'n'}`, 12, 15, b => {
      b.rect(2, 4, 8, 11, p.base); b.rect(3, 0, 6, 5, p.skin);
      b.rect(3, 1, 6, 2, trim || p.band); b.rect(3, 11, 2, 4, '#1a1430');
      b.rect(7, 11, 2, 4, '#1a1430');
    });
    case 'spider': return make(`e_spider_${elite ? 'x' : 'n'}`, 12, 10, b => {
      b.rect(2, 2, 8, 6, elite ? p.lite : p.base);
      b.rect(4, 4, 2, 2, p.eye); b.rect(7, 4, 2, 2, p.eye);
      b.rect(1, 3, 1, 4, p.base); b.rect(10, 3, 1, 4, p.base);
    });
  }
}
for (const t of Object.keys(EPAL)) { enemySprite(t, false); enemySprite(t, true); }
// Деталі, що рухаються окремо від тіла
make('e_pipe', 12, 2, b => b.rect(0, 0, 12, 2, '#c7d3e0'));
make('e_blade', 16, 2, b => { b.rect(0, 0, 16, 2, '#7df9ff'); b.rect(0, 0, 4, 1, '#ffffff'); });
make('e_wing', 5, 2, b => b.rect(0, 0, 5, 2, '#bff4ffcc'));
make('e_plate', 6, 20, b => { b.rect(0, 0, 6, 20, '#22e0ff'); b.rect(1, 2, 4, 16, '#7df9ff'); });
make('e_leg', 3, 2, b => b.rect(0, 0, 3, 2, '#3a2450'));

/* ----------------------------------------------------------------- БОСИ */
make('b_taur_body', 40, 24, b => {
  b.rect(2, 4, 36, 16, '#5a6472'); b.rect(4, 6, 32, 5, '#39414d');
  b.rect(2, 18, 36, 3, '#2b323c');
});
make('b_taur_head', 12, 12, b => {
  b.rect(0, 0, 12, 12, '#7a8697'); b.rect(8, 4, 4, 3, '#ffd23f'); b.rect(0, 8, 12, 2, '#39414d');
});
make('b_taur_horn', 4, 6, b => b.rect(0, 0, 4, 6, '#c7d3e0'));
make('b_taur_leg', 5, 9, b => b.rect(0, 0, 5, 9, '#39414d'));
make('b_queen_body', 36, 24, b => {
  b.rect(4, 4, 28, 18, '#6a4a1a'); b.rect(8, 1, 20, 6, '#c9a227');
  b.rect(8, 8, 4, 3, '#ff3355'); b.rect(24, 8, 4, 3, '#ff3355');
  b.rect(12, 20, 12, 4, '#8a5a2a');
});
make('b_queen_wing', 10, 4, b => b.rect(0, 0, 10, 4, '#bff4ffbb'));
make('b_node', 14, 14, b => {
  b.rect(0, 0, 14, 14, '#3a2a5a'); b.rect(3, 3, 8, 8, '#22e0ff'); b.rect(5, 5, 4, 4, '#bff4ff');
});
make('b_chrono_body', 14, 22, b => {
  b.rect(1, 5, 12, 17, '#241a44'); b.rect(2, 0, 10, 6, '#e0d0ff'); b.rect(2, 1, 10, 2, '#ff2e88');
});
make('b_chrono_blade', 20, 2, b => { b.rect(0, 0, 20, 2, '#7df9ff'); b.rect(14, 0, 6, 1, '#ffffff'); });
make('b_glitch_core', 26, 26, b => {
  b.rect(0, 0, 26, 26, '#0a0a28'); b.rect(2, 2, 22, 22, '#00ffcc');
  b.rect(8, 8, 10, 10, '#0a0a28');
});
make('b_arch_body', 22, 30, b => {
  b.rect(3, 8, 16, 18, '#2e2450'); b.rect(1, 10, 20, 6, '#5b238c');
  b.rect(5, 0, 12, 9, '#d8f0ff'); b.rect(6, 3, 10, 3, '#22e0ff');
  b.rect(5, 26, 4, 4, '#2e2450'); b.rect(13, 26, 4, 4, '#2e2450');
});
make('b_arch_core', 16, 16, b => {
  b.rect(0, 0, 16, 16, '#3a2a6a'); b.rect(3, 3, 10, 10, '#22e0ff'); b.rect(6, 6, 4, 4, '#ffffff');
});
make('b_arch_head', 60, 52, b => {
  b.rect(0, 0, 60, 52, '#2e2450'); b.rect(4, 4, 52, 40, '#443168');
  b.rect(8, 12, 16, 8, '#ff2e88'); b.rect(36, 12, 16, 8, '#ff2e88');
  for (let i = 0; i < 6; i++) b.rect(8 + i * 8, 40, 5, 10, '#c7d3e0');
});

/* ---------------------------------------------------------------- ТАЙЛИ */
for (const [key, th] of Object.entries(THEME)) {
  make(`t_${key}_solid`, 16, 16, b => {
    b.rect(0, 0, 16, 16, th.tile);
    b.rect(0, 13, 16, 3, '#00000038'); b.rect(13, 0, 3, 16, '#00000030');
    b.rect(5, 6, 3, 3, th.glow + '44');
  });
  make(`t_${key}_top`, 16, 16, b => {
    b.rect(0, 0, 16, 16, th.tile);
    b.rect(0, 13, 16, 3, '#00000038'); b.rect(13, 0, 3, 16, '#00000030');
    b.rect(0, 0, 16, 2, th.edge); b.rect(0, 2, 16, 2, th.edge + '30');
  });
  make(`t_${key}_plat`, 16, 6, b => {
    b.rect(0, 0, 16, 5, th.tile); b.rect(0, 0, 16, 2, th.edge);
    b.rect(0, 5, 16, 1, th.glow + '40');
  });
  make(`t_${key}_conv`, 16, 16, b => {
    b.rect(0, 0, 16, 16, '#2a2a3a'); b.rect(0, 0, 16, 2, th.edge);
    b.rect(0, 5, 4, 2, th.glow); b.rect(8, 5, 4, 2, th.glow);
  });
}
make('t_spike', 16, 16, b => {
  for (let i = 0; i < 4; i++) {
    const x = i * 4;
    b.rect(x + 1, 12, 2, 4, '#c7d3e0'); b.rect(x + 1, 8, 2, 4, '#e6eef7');
    b.rect(x + 1, 5, 1, 3, '#ffffff');
  }
  b.rect(0, 14, 16, 2, '#ff2e8899');
});

/* ------------------------------------------------- НЕБО Й МАСКА ТЕМРЯВИ */
for (const [key, th] of Object.entries(THEME)) {
  make(`sky_${key}`, 4, 64, b => {
    const a = Bitmap.rgba(th.sky[0]), c = Bitmap.rgba(th.sky[1]);
    for (let y = 0; y < 64; y++) {
      const k = y / 63;
      b.rect(0, y, 4, 1, [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, 255]);
    }
  });
}
// «Дірка» ліхтаря: чорне полотно з прозорим центром (метро, ядро).
make('dark_hole', 256, 256, b => {
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const d = Math.hypot(x - 128, y - 128) / 118;
    const a = Math.min(1, Math.max(0, (d - 0.35) / 0.65));
    b.blend(x, y, 3, 2, 9, a * 255);
  }
});

/* ------------------------------------------------------- ЕФЕКТИ Й СВІТЛО */
make('px', 1, 1, b => b.rect(0, 0, 1, 1, '#ffffff'));
make('glow', 64, 64, b => b.radial(32, 32, 32, '#ffffff', 2.2));
make('glow_soft', 128, 128, b => b.radial(64, 64, 64, '#ffffff', 3.0));
make('flare', 64, 16, b => b.ellipse(32, 8, 32, 8, '#ffffffcc'));
make('ring', 64, 64, b => b.ring(32, 32, 28, 3, '#ffffff'));
make('shadow', 24, 8, b => b.ellipse(12, 4, 11, 3.5, '#00000099'));
make('heart', 7, 6, b => {
  b.rect(1, 0, 2, 1, '#ff2e88'); b.rect(4, 0, 2, 1, '#ff2e88');
  b.rect(0, 1, 7, 2, '#ff2e88'); b.rect(1, 3, 5, 1, '#ff2e88');
  b.rect(2, 4, 3, 1, '#ff2e88'); b.rect(3, 5, 1, 1, '#ff2e88');
  b.rect(1, 1, 1, 1, '#ffb7d5');
});
make('drop', 1, 6, b => b.rect(0, 0, 1, 6, '#8fdcff'));
make('petal', 2, 2, b => b.rect(0, 0, 2, 2, '#ffb7d5'));

/* --------------------------------------------------------- ЗАПИС АТЛАСУ */
const { atlas, frames } = pack(items, 512);
function writePNG(bmp, file) {
  const png = new PNG({ width: bmp.w, height: bmp.h });
  png.data = Buffer.from(bmp.data.buffer, bmp.data.byteOffset, bmp.data.length);
  fs.writeFileSync(file, PNG.sync.write(png));
}
writePNG(atlas, path.join(outDir, 'atlas.png'));
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify({
  meta: { image: 'atlas.png', size: { w: atlas.w, h: atlas.h }, scale: 1, format: 'RGBA8888' },
  frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, {
    frame: f, sourceSize: { w: f.w, h: f.h }, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }
  }]))
}, null, 0));

const noise = new Bitmap(128, 128); noise.noise(7);
writePNG(noise, path.join(outDir, 'noise.png'));

/* -------------------------------------------- ІКОНКИ ТА SPLASH ДЛЯ ANDROID */
function iconBitmap(size) {
  const b = new Bitmap(size, size);
  const s = size / 48;                                 // базова сітка 48x48
  b.rect(0, 0, size, size, '#150a22');
  // неонове коло-підсвітка
  const g = new Bitmap(size, size);
  g.radial(size / 2, size * 0.56, size * 0.46, '#5b238c', 1.6);
  g.blitTo(b, 0, 0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (g.data[i + 3]) b.blend(x, y, g.data[i], g.data[i + 1], g.data[i + 2], g.data[i + 3] * 0.75);
  }
  // силует Ехо з жовтим шарфом
  const put = (rows, pal, ox, oy, sc) => {
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const c = pal[rows[y][x]]; if (!c) continue;
      b.rect(Math.round(ox + x * sc), Math.round(oy + y * sc), Math.ceil(sc), Math.ceil(sc), c);
    }
  };
  const sc = s * 2.3;
  put(HERO.run1, { ...PAL_HERO, '1': '#f7c9a6' }, size / 2 - 6 * sc, size / 2 - 8 * sc, sc);
  // шарф
  b.rect(size / 2 - 8 * sc, size / 2 - 2.2 * sc, 7 * sc, 1.2 * sc, '#ffd23f');
  b.rect(size / 2 - 11 * sc, size / 2 - 1.2 * sc, 4 * sc, 1.1 * sc, '#ffb03f');
  return b;
}
const DPI = { 'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192 };
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');
const iconOut = path.join(root, 'build-res');
fs.mkdirSync(iconOut, { recursive: true });
for (const [dpi, size] of Object.entries(DPI)) {
  const bmp = iconBitmap(size);
  writePNG(bmp, path.join(iconOut, `ic_launcher_${dpi}.png`));
  for (const dir of [`mipmap-${dpi}`]) {
    const d = path.join(resDir, dir);
    if (fs.existsSync(resDir)) {
      fs.mkdirSync(d, { recursive: true });
      writePNG(bmp, path.join(d, 'ic_launcher.png'));
      writePNG(bmp, path.join(d, 'ic_launcher_round.png'));
      writePNG(bmp, path.join(d, 'ic_launcher_foreground.png'));
    }
  }
}
// splash 1280x720 у стилі гри
const splash = new Bitmap(1280, 720);
splash.rect(0, 0, 1280, 720, '#0b0413');
const halo = new Bitmap(1280, 720); halo.radial(640, 300, 420, '#5b238c', 2.2);
for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
  const i = (y * 1280 + x) * 4;
  if (halo.data[i + 3]) splash.blend(x, y, halo.data[i], halo.data[i + 1], halo.data[i + 2], halo.data[i + 3] * 0.6);
}
{
  const sc = 14;
  const ox = 640 - 6 * sc, oy = 360 - 8 * sc;
  for (let y = 0; y < HERO.idle.length; y++) for (let x = 0; x < HERO.idle[y].length; x++) {
    const c = PAL_HERO[HERO.idle[y][x]]; if (!c) continue;
    splash.rect(ox + x * sc, oy + y * sc, sc, sc, c);
  }
  splash.rect(ox - 3 * sc, oy + 6.2 * sc, 8 * sc, 1.3 * sc, '#ffd23f');
  splash.rect(ox - 6 * sc, oy + 7.4 * sc, 5 * sc, 1.2 * sc, '#ffb03f');
}
writePNG(splash, path.join(iconOut, 'splash.png'));
if (fs.existsSync(resDir)) {
  for (const d of ['drawable', 'drawable-land-xxxhdpi', 'drawable-port-xxxhdpi']) {
    const dd = path.join(resDir, d);
    if (fs.existsSync(dd)) writePNG(splash, path.join(dd, 'splash.png'));
  }
}

console.log(`атлас: ${atlas.w}x${atlas.h}, кадрів ${Object.keys(frames).length}, ` +
            `${(fs.statSync(path.join(outDir, 'atlas.png')).size / 1024).toFixed(1)} КБ`);
console.log(`іконки: ${Object.keys(DPI).join(', ')} + splash 1280x720`);
