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


/* ------------------------------------------------------------ ГЕРОЇНЯ
   16x22, по чотири тони на кожен матеріал (база, тінь, світло, відблиск).
   Малюється прямокутниками — так легше тримати однакове освітлення
   в усіх дев'яти позах. Хітбокс у грі лишається 10x14, спрайт
   прив'язаний до ніг. */
const HP = {
  skinB: '#f7c9a6', skinS: '#c9805c', skinL: '#ffe3c6', skinR: '#fff5e6',
  hoodB: '#ff2e88', hoodS: '#a0104f', hoodL: '#ff7fb5', hoodR: '#ffd6e8',
  jacB: '#5b238c', jacS: '#2a1140', jacL: '#8b3fd0', jacR: '#c48cff',
  chrB: '#d8f0ff', chrS: '#7fa8c9', chrL: '#ffffff', chrR: '#eaf9ff',
  visor: '#22e0ff', visorL: '#bff4ff',
  bootB: '#241338', bootS: '#150a22', bootL: '#3d2456',
  scarf: '#ffd23f', scarfS: '#c98a12'
};
function heroFrame(pose) {
  const b = new Bitmap(16, 22);
  const P = HP;
  const body = (oy) => {
    // капюшон
    b.rect(4, 0 + oy, 8, 2, P.hoodB);
    b.rect(3, 1 + oy, 10, 3, P.hoodB);
    b.rect(3, 1 + oy, 10, 1, P.hoodL);
    b.rect(3, 3 + oy, 10, 1, P.hoodS);
    b.rect(12, 1 + oy, 1, 3, P.hoodR);
    // обличчя й візор
    b.rect(4, 4 + oy, 8, 4, P.skinB);
    b.rect(4, 4 + oy, 8, 1, P.skinL);
    b.rect(4, 7 + oy, 8, 1, P.skinS);
    b.rect(11, 4 + oy, 1, 4, P.skinR);
    b.rect(5, 5 + oy, 6, 2, P.visor);
    b.rect(5, 5 + oy, 6, 1, P.visorL);
    // куртка
    b.rect(3, 8 + oy, 10, 7, P.jacB);
    b.rect(3, 8 + oy, 10, 1, P.jacL);
    b.rect(3, 14 + oy, 10, 1, P.jacS);
    b.rect(3, 8 + oy, 1, 7, P.jacS);
    b.rect(12, 8 + oy, 1, 7, P.jacR);
    b.rect(5, 10 + oy, 6, 3, P.jacS);
  };
  const legs = (lx, ly, rx, ry) => {
    b.rect(4 + lx, 15 + ly, 3, 5, P.jacS);
    b.rect(4 + lx, 19 + ly, 4, 3, P.bootB);
    b.rect(4 + lx, 19 + ly, 4, 1, P.bootL);
    b.rect(9 + rx, 15 + ry, 3, 5, P.jacS);
    b.rect(8 + rx, 19 + ry, 4, 3, P.bootB);
    b.rect(8 + rx, 19 + ry, 4, 1, P.bootL);
  };
  const armChrome = (x, y, len) => {
    b.rect(x, y, len, 3, P.chrB);
    b.rect(x, y, len, 1, P.chrL);
    b.rect(x, y + 2, len, 1, P.chrS);
    b.rect(x + len - 1, y, 1, 3, P.chrR);
  };
  const armJacket = (x, y, len) => {
    b.rect(x, y, len, 3, P.jacB);
    b.rect(x, y, len, 1, P.jacL);
    b.rect(x, y + 2, len, 1, P.jacS);
  };
  switch (pose) {
    case 'idle': body(0); legs(0, 0, 0, 0); armJacket(1, 9, 3); armChrome(12, 9, 4); break;
    case 'blink':
      body(0); legs(0, 0, 0, 0); armJacket(1, 9, 3); armChrome(12, 9, 4);
      b.rect(5, 5, 6, 2, P.skinB); b.rect(5, 5, 6, 1, P.skinS); break;
    case 'run1': body(0); legs(-2, 0, 2, 1); armJacket(0, 8, 4); armChrome(12, 10, 4); break;
    case 'run2': body(1); legs(0, 0, 0, 0); armJacket(1, 10, 3); armChrome(11, 9, 4); break;
    case 'run3': body(0); legs(2, 1, -2, 0); armJacket(2, 10, 3); armChrome(13, 8, 3); break;
    case 'jump': body(0); legs(-1, -1, 1, 0); armJacket(0, 7, 4); armChrome(12, 7, 4); break;
    case 'fall': body(0); legs(-2, 0, 2, -1); armJacket(0, 6, 4); armChrome(12, 6, 4); break;
    case 'atk':  body(0); legs(-1, 0, 1, 0); armJacket(1, 11, 3); armChrome(12, 8, 4);
                 b.rect(15, 8, 1, 3, P.chrR); break;
    case 'crouch':
      body(4); legs(-1, 2, 1, 2); armJacket(1, 13, 3); armChrome(12, 13, 4); break;
    case 'hurt': body(0); legs(-2, 0, 2, 0); armJacket(0, 7, 4); armChrome(12, 11, 4);
                 b.rect(3, 8, 10, 7, '#ff2e8855'); break;
    // приземлення: присідання глибше за crouch, руки йдуть униз
    case 'land':
      body(3); legs(-2, 2, 2, 2); armJacket(0, 13, 4); armChrome(12, 13, 4);
      b.rect(2, 21, 12, 1, '#22e0ff44'); break;
    // довгий простій: Ехо піднімає хромовану руку й поправляє протез
    case 'idle2a':
      body(0); legs(0, 0, 0, 0); armJacket(1, 9, 3);
      armChrome(11, 7, 3); b.rect(12, 5, 2, 3, P.chrB); b.rect(12, 5, 2, 1, P.chrL); break;
    case 'idle2b':
      body(0); legs(0, 0, 0, 0); armJacket(1, 9, 3);
      armChrome(10, 6, 3); b.rect(11, 4, 3, 3, P.chrB); b.rect(11, 4, 3, 1, P.chrL);
      b.rect(12, 5, 1, 1, P.visorL); break;
  }
  return b;
}
const HERO_POSES = ['idle', 'blink', 'run1', 'run2', 'run3', 'jump', 'fall', 'atk',
                    'crouch', 'hurt', 'land', 'idle2a', 'idle2b'];
for (const pose of HERO_POSES) add('hero_' + pose, heroFrame(pose));
// фантом — та сама фігура в примарній палітрі
{
  const swap = { skinB: '#6ef7d8', skinS: '#1f8f7a', skinL: '#bafff0', skinR: '#ffffff',
    hoodB: '#1f8f7a', hoodS: '#08302c', hoodL: '#6ef7d8', hoodR: '#bafff0',
    jacB: '#12604f', jacS: '#08302c', jacL: '#2fae90', jacR: '#6ef7d8',
    chrB: '#bafff0', chrS: '#2fae90', chrL: '#ffffff', chrR: '#ffffff',
    visor: '#ffffff', visorL: '#ffffff', bootB: '#04211d', bootS: '#021512', bootL: '#0d3a33',
    scarf: '#6ef7d8', scarfS: '#1f8f7a' };
  const keep = { ...HP };
  Object.assign(HP, swap);
  for (const pose of ['idle', 'run1', 'run2', 'run3', 'jump', 'fall', 'atk', 'crouch', 'hurt'])
    add('phantom_' + pose, heroFrame(pose));
  Object.assign(HP, keep);
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
/* --- Нові типи (Промт №5). Кожен має власний силует: тарано-бот — низький
   клин на котках, ковадло — верхня вага з кулаками, носій — широкий корпус
   із трюмом, пілон — висока щогла з короною, блінк-щур — присідання з
   хвостом, хробак — сегменти зі свердлом, конструкти — три різні постаті. */
const NEWE = {
  rammer: { w: 14, h: 12, trim: 'S',
    pal: { '#': '#8a4a22', L: '#c4762f', D: '#4a2410', S: '#d8f0ff', E: '#ff3355', o: '#1a1030' },
    rows: ['..........SSS.', '..........SSS.', '...LLLLLL.SSS.', '..########SSSS',
           '.#########SSSS', '.###E#####SSSS', '.###E#####SSSS', '.#########SSSS',
           '..########SSSS', '..DDDDDDD.SSS.', '.oo..oo..oo...', '.oo..oo..oo...'] },
  anvil: { w: 16, h: 16, trim: 'F',
    pal: { '#': '#4a4f5e', L: '#6b7285', D: '#252a36', F: '#c7d3e0', E: '#ff8a3d' },
    rows: ['.....######.....', '....########....', '....#EE##EE#....', '....########....',
           '..############..', '.##############.', '.##############.', 'FF############FF',
           'FFFF########FFFF', 'FFFF########FFFF', 'FFFF..####..FFFF', '.FF...####...FF.',
           '......####......', '....###..###....', '...####..####...', '...####..####...'] },
  carrier: { w: 18, h: 14, trim: 'H',
    pal: { '#': '#2f5f66', L: '#57a8b0', D: '#173338', H: '#7df9ff', E: '#ff3355', o: '#bff4ff' },
    rows: ['..................', '...LLLLLLLLLLLL...', '..L############L..', '.L##############L.',
           '.################.', '.##EE########EE##.', '.################.', '..DD##########DD..',
           '....##########....', '....#HHHHHHHH#....', '....#HHHHHHHH#....', '.....########.....',
           '..oo..........oo..', '..oo..........oo..'] },
  pylon: { w: 12, h: 20, trim: 'G',
    pal: { '#': '#3c2a63', G: '#8b3fd0', C: '#22e0ff' },
    rows: ['...GGGGGG...', '..G######G..', '.G########G.', '.G##CCCC##G.', '.G##CCCC##G.',
           '.G########G.', '..G######G..', '...######...', '....####....', '....####....',
           '....####....', '...######...', '...#CCCC#...', '...######...', '....####....',
           '....####....', '....####....', '...######...', '..########..', '.##########.'] },
  blinker: { w: 12, h: 10, trim: 'T',
    pal: { '#': '#2a1440', T: '#ff2e88', E: '#ffd23f' },
    rows: ['.T..........', '.TT.........', '..TT.#####..', '...T#######.', '....########',
           '...#####EE##', '...########.', '....######..', '...#..##..#.', '...#..##..#.'] },
  worm: { w: 14, h: 10, trim: 'D',
    pal: { '#': '#4c7a1e', L: '#8fd13a', D: '#c7d3e0', E: '#ff3355' },
    rows: ['..............', '..##..##..#...', '.LLLL.LLLL.LL.', '.##########DDD',
           '###########DDD', '########E##DDD', '.##########DDD', '.LLLL.LLLL.LL.',
           '..##..##..#...', '..............'] },
  arch1: { w: 16, h: 20, trim: 'H',
    pal: { '#': '#d8e6f2', D: '#7f93ad', C: '#ffb347', H: '#ffd23f' },
    rows: ['................', '.....######.....', '....########....', '....##CC##CC..HH',
           '....########..HH', '.....######.....', '..############..', '.##############.',
           '.##############.', '.####CCCCCC####.', '.##############.', '..############..',
           '...##########...', '...####..####...', '...####..####...', '....###..###....',
           '....###..###....', '....###..###....', '...####..####...', '...####..####...'] },
  arch2: { w: 16, h: 20, trim: 'R',
    pal: { '#': '#d8e6f2', C: '#ff3355', R: '#ff2e88' },
    rows: ['................', '......####......', '.....######.....', '....########....',
           '....##CCCC##....', '....##CCCC##....', '....########....', '.....######.....',
           'RR..########..RR', 'RR.##########.RR', 'RR.##########.RR', 'RR.##########.RR',
           'RR..########..RR', '.....######.....', '......####......', '......####......',
           '.....######.....', '....########....', '...####..####...', '...####..####...'] },
  arch3: { w: 16, h: 20, trim: 'B',
    pal: { '#': '#d8e6f2', C: '#22e0ff', B: '#7df9ff' },
    rows: ['.......CC.......', '.......CC.......', '......####......', '.....######.....',
           '.....#CC#.......', '.....######.....', '......####......', '....########..BB',
           '....########.BB.', '....########BB..', '....########....', '.....######.....',
           '.....######.....', '.....######.....', '.....##..##.....', '.....##..##.....',
           '.....##..##.....', '.....##..##.....', '....###..###....', '....###..###....'] }
};
for (const [t, d] of Object.entries(NEWE)) for (const el of [false, true]) {
  const pal = { ...d.pal };
  if (el) pal[d.trim] = GOLD;
  make(`e_${t}_${el ? 'x' : 'n'}`, d.w, d.h, b => b.art(d.rows, pal));
}
// Дрібні супутники нових типів
make('e_mote', 6, 6, b => { b.rect(1, 0, 4, 6, '#7df9ff'); b.rect(0, 1, 6, 4, '#7df9ff'); b.rect(2, 2, 2, 2, '#ffffff'); });
make('e_link', 4, 4, b => b.rect(0, 0, 4, 4, '#22e0ffaa'));
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

/* ------------------------------------------------- ІКОНКИ ЗБРОЇ 16x16 */
// Кожна іконка — інша форма: тесак, ланцюг, довбня, рапіра, кігті,
// довгий ствол, пістолет, касета, дві цівки, збій.
function seg(b, x0, y0, x1, y1, col, th = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
    b.rect(x, y, th, th, col);
  }
}
make('w_arc', 16, 16, b => {
  seg(b, 3, 13, 12, 4, '#5b238c', 3);
  seg(b, 4, 12, 13, 3, '#22e0ff', 2);
  seg(b, 5, 11, 14, 2, '#bff4ff', 1);
  b.rect(1, 12, 4, 3, '#ff2e88'); b.rect(0, 14, 3, 2, '#a0104f');
});
make('w_whip', 16, 16, b => {
  b.rect(0, 12, 4, 4, '#5b238c');
  for (const [x, y] of [[4, 11], [6, 8], [8, 9], [10, 5], [12, 6], [13, 2]]) {
    b.rect(x, y, 3, 3, '#ffd23f'); b.rect(x + 1, y + 1, 1, 1, '#fff6c9');
  }
  b.rect(13, 0, 3, 2, '#7df9ff');
});
make('w_brand', 16, 16, b => {
  b.rect(6, 7, 4, 9, '#5b238c'); b.rect(6, 13, 4, 3, '#2a1140');
  b.rect(2, 1, 12, 7, '#8a3a1a'); b.rect(2, 1, 12, 2, '#c4762f');
  b.rect(4, 3, 8, 4, '#ff8a3d'); b.rect(7, 4, 2, 2, '#fff0c9');
});
make('w_chrono', 16, 16, b => {
  seg(b, 3, 13, 14, 2, '#e0d0ff', 2);
  seg(b, 4, 12, 15, 1, '#ffffff', 1);
  b.ring(5, 11, 3.2, 1.3, '#22e0ff');
  b.rect(0, 13, 4, 3, '#241a44');
});
make('w_claws', 16, 16, b => {
  for (let i = 0; i < 3; i++) {
    seg(b, 2 + i * 4, 14, 7 + i * 4, 3, '#00ffcc', 2);
    seg(b, 3 + i * 4, 13, 8 + i * 4, 2, '#d9fff6', 1);
  }
  b.rect(0, 12, 6, 4, '#2a1140');
});
make('w_rail', 16, 16, b => {
  b.rect(1, 6, 14, 4, '#4a5568'); b.rect(1, 6, 14, 1, '#8fa3bd');
  for (let i = 0; i < 3; i++) b.rect(4 + i * 4, 4, 2, 8, '#22e0ff');
  b.rect(14, 5, 2, 6, '#bff4ff'); b.rect(0, 9, 5, 5, '#2a3140');
});
make('w_osa', 16, 16, b => {
  b.rect(2, 5, 12, 4, '#5a6472'); b.rect(2, 5, 12, 1, '#9aa8bb');
  b.rect(3, 9, 4, 6, '#2a1140'); b.rect(13, 6, 3, 2, '#ffd23f');
  b.rect(7, 9, 3, 2, '#39414d');
});
make('w_swarm', 16, 16, b => {
  b.rect(2, 3, 12, 10, '#3a4a6a'); b.rect(2, 3, 12, 1, '#6b83ad');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    b.rect(4 + i * 5, 5 + j * 4, 3, 3, '#0a0a28'); b.rect(5 + i * 5, 6 + j * 4, 1, 1, '#ff3355');
  }
  b.rect(3, 13, 5, 3, '#2a1140');
});
make('w_shot', 16, 16, b => {
  b.rect(2, 5, 11, 3, '#6a4a2a'); b.rect(2, 8, 11, 3, '#4a2f18');
  b.rect(12, 4, 4, 8, '#8a8f9e'); b.rect(13, 5, 2, 2, '#0a0a28'); b.rect(13, 9, 2, 2, '#0a0a28');
  b.rect(0, 8, 4, 5, '#3a2418'); b.rect(2, 5, 11, 1, '#a07a4a');
});
make('w_prism', 16, 16, b => {
  // трикутна призма з розщепленим променем
  for (let y = 0; y < 11; y++) {
    const w = Math.round((y + 1) * 0.9);
    b.rect(8 - Math.floor(w / 2), 3 + y, w, 1, '#8fdcff');
  }
  b.rect(6, 12, 5, 1, '#bff4ff');
  b.rect(0, 7, 5, 1, '#ffffff');                  // вхідний промінь
  b.rect(11, 4, 5, 1, '#ff2e88');                 // розщеплені
  b.rect(11, 8, 5, 1, '#ffd23f');
  b.rect(11, 12, 4, 1, '#22e0ff');
  b.rect(7, 6, 2, 3, '#ffffff88');
});
make('w_heartmod', 16, 16, b => {
  b.rect(2, 3, 12, 10, '#3a2a5a'); b.rect(2, 3, 12, 1, '#6b5a9a');
  b.rect(4, 5, 8, 6, '#ff2e88'); b.rect(5, 6, 2, 2, '#ffb7d5');
  b.rect(1, 7, 2, 2, '#22e0ff'); b.rect(13, 7, 2, 2, '#22e0ff');
  b.rect(4, 13, 3, 3, '#241338'); b.rect(9, 13, 3, 3, '#241338');
});
make('w_key', 16, 16, b => {
  b.rect(1, 6, 9, 4, '#ffd23f'); b.rect(1, 6, 9, 1, '#fff6c9');
  b.ring(11, 8, 3.4, 1.6, '#ffd23f');
  b.rect(3, 10, 2, 3, '#c98a12'); b.rect(6, 10, 2, 2, '#c98a12');
  b.rect(10, 7, 2, 2, '#22e0ff');
});
make('frag', 9, 10, b => {
  b.rect(3, 0, 3, 1, '#bff4ff');
  b.rect(2, 1, 5, 2, '#8fdcff');
  b.rect(1, 3, 7, 4, '#8fdcff');
  b.rect(2, 7, 5, 2, '#5aa8d8');
  b.rect(3, 9, 3, 1, '#3a7aa8');
  b.rect(3, 2, 2, 4, '#ffffff');
});
make('w_glitch', 16, 16, b => {
  b.rect(2, 3, 10, 4, '#00ffcc'); b.rect(4, 7, 10, 3, '#ff2e88');
  b.rect(1, 10, 8, 3, '#22e0ff'); b.rect(9, 12, 5, 3, '#ffd23f');
  b.rect(6, 5, 3, 8, '#0a0a28');
});

/* ------------------------------------------- МАРКЕРИ УВАГИ ВОРОГІВ */
make('mk_q', 5, 8, b => {
  b.rect(1, 0, 3, 2, '#bff4ff'); b.rect(3, 1, 2, 3, '#bff4ff');
  b.rect(2, 3, 2, 2, '#bff4ff'); b.rect(2, 6, 2, 2, '#bff4ff');
});
make('mk_ex', 3, 8, b => { b.rect(0, 0, 3, 5, '#ffd23f'); b.rect(0, 6, 3, 2, '#ffd23f'); });

/* -------------------------------------------------- ПОРТРЕТИ 48x48 */
function portrait(name, fn) {
  return make(name, 48, 48, b => {
    b.rect(0, 0, 48, 48, '#120a26');
    b.radial(24, 30, 32, '#2a1a4a', 1.4);
    fn(b);
    b.rect(0, 0, 48, 1, '#ff2e8899'); b.rect(0, 47, 48, 1, '#ff2e8899');
    b.rect(0, 0, 1, 48, '#ff2e8899'); b.rect(47, 0, 1, 48, '#ff2e8899');
  });
}
portrait('p_echo', b => {
  b.rect(9, 36, 30, 12, HP.jacB); b.rect(9, 36, 30, 3, HP.jacL);
  b.rect(13, 6, 22, 30, HP.hoodB); b.rect(13, 6, 22, 4, HP.hoodL);
  b.rect(13, 6, 4, 30, HP.hoodS); b.rect(31, 6, 4, 30, HP.hoodS);
  b.rect(17, 12, 14, 22, HP.skinB); b.rect(17, 28, 14, 6, HP.skinS);
  b.rect(15, 16, 18, 6, '#150a22'); b.rect(16, 17, 16, 4, HP.visor);
  b.rect(18, 18, 5, 2, HP.visorL);
  b.rect(20, 30, 8, 2, HP.skinS);
  b.rect(12, 34, 24, 6, HP.scarf); b.rect(12, 39, 24, 2, HP.scarfS);
  b.rect(34, 34, 8, 12, HP.scarf); b.rect(34, 44, 8, 2, HP.scarfS);
});
portrait('p_servotaur', b => {
  b.rect(2, 10, 10, 12, '#c7d3e0'); b.rect(36, 10, 10, 12, '#c7d3e0');
  b.rect(2, 10, 10, 3, '#ffffff'); b.rect(36, 10, 10, 3, '#ffffff');
  b.rect(8, 18, 32, 26, '#5a6472'); b.rect(8, 18, 32, 4, '#8592a3');
  b.rect(11, 22, 26, 8, '#39414d');
  b.rect(13, 24, 8, 5, '#ffd23f'); b.rect(27, 24, 8, 5, '#ffd23f');
  b.rect(14, 25, 3, 2, '#fff6c9');
  b.rect(15, 34, 18, 10, '#2b323c');
  for (let i = 0; i < 4; i++) b.rect(16 + i * 5, 34, 3, 10, '#c7d3e0');
});
portrait('p_queen', b => {
  b.rect(5, 3, 5, 15, '#c9a227'); b.rect(38, 3, 5, 15, '#c9a227');
  b.rect(10, 14, 28, 28, '#6a4a1a'); b.rect(10, 14, 28, 5, '#c9a227');
  b.rect(13, 21, 9, 9, '#ff3355'); b.rect(26, 21, 9, 9, '#ff3355');
  b.rect(14, 22, 3, 3, '#ffb7c5'); b.rect(27, 22, 3, 3, '#ffb7c5');
  b.rect(16, 33, 16, 4, '#8a5a2a');
  b.rect(13, 38, 5, 9, '#c9a227'); b.rect(30, 38, 5, 9, '#c9a227');
});
portrait('p_chrono', b => {
  seg(b, 4, 44, 42, 4, '#2e2a55', 4);
  seg(b, 6, 44, 44, 6, '#7df9ff', 2);
  b.rect(11, 34, 26, 14, '#241a44'); b.rect(11, 34, 26, 2, '#3a2a6a');
  b.rect(14, 8, 20, 28, '#e0d0ff'); b.rect(14, 8, 20, 4, '#ffffff');
  b.rect(12, 13, 24, 5, '#ff2e88');
  b.rect(18, 21, 4, 9, '#241a44'); b.rect(26, 21, 4, 9, '#241a44');
  b.rect(20, 32, 8, 2, '#a08fc0');
});
portrait('p_glitch', b => {
  b.rect(6, 6, 36, 36, '#0a0a28'); b.rect(9, 9, 30, 30, '#00ffcc');
  b.rect(16, 16, 16, 16, '#0a0a28');
  for (let y = 6; y < 42; y += 4) b.rect(6, y, 36, 1, '#0a0a28aa');
  b.rect(2, 18, 13, 5, '#ff2e88'); b.rect(33, 26, 13, 5, '#22e0ff');
  b.rect(20, 20, 8, 8, '#ffffff44');
});
portrait('p_architect', b => {
  b.rect(8, 30, 32, 18, '#2e2450'); b.rect(5, 32, 38, 6, '#5b238c');
  b.rect(11, 3, 26, 29, '#d8e6f2'); b.rect(11, 3, 26, 4, '#ffffff');
  b.rect(11, 3, 3, 29, '#8fa3bd'); b.rect(34, 3, 3, 29, '#8fa3bd');
  b.rect(13, 11, 22, 7, '#22e0ff'); b.rect(15, 12, 6, 3, '#bff4ff');
  for (let i = 0; i < 6; i++) b.rect(13 + i * 4, 23, 3, 9, '#8fa3bd');
  b.rect(20, 36, 8, 8, '#22e0ff'); b.rect(22, 38, 4, 4, '#ffffff');
});

/* --------------------------------------------------------- ЗАПИС АТЛАСУ */
const { atlas, frames } = pack(items, 512);
function writePNG(bmp, file) {
  const png = new PNG({ width: bmp.w, height: bmp.h });
  png.data = Buffer.from(bmp.data.buffer, bmp.data.byteOffset, bmp.data.length);
  fs.writeFileSync(file, PNG.sync.write(png));
}
writePNG(atlas, path.join(outDir, 'atlas.png'));
// Іконки зброї — ще й окремими PNG: їх показує DOM-екран «Арсенал»,
// який не має доступу до атласу PixiJS.
const wpnDir = path.join(outDir, 'wpn');
fs.mkdirSync(wpnDir, { recursive: true });
let nWpn = 0;
for (const it of items) if (it.name.startsWith('w_')) { writePNG(it.bmp, path.join(wpnDir, it.name.slice(2) + '.png')); nWpn++; }

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

console.log(`іконки зброї: ${nWpn} PNG`);
console.log(`атлас: ${atlas.w}x${atlas.h}, кадрів ${Object.keys(frames).length}, ` +
            `${(fs.statSync(path.join(outDir, 'atlas.png')).size / 1024).toFixed(1)} КБ`);
console.log(`іконки: ${Object.keys(DPI).join(', ')} + splash 1280x720`);
