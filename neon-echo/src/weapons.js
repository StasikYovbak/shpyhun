/**
 * Арсенал: п'ять ближніх і п'ять дальніх. Дві активні комірки — одна
 * ближня, одна дальня. Тут лише дані й правила видачі; механіки живуть
 * у core.js, бо працюють зі станом світу.
 *
 * Смужки dmg/spd/rng — 0..5, для екрана інвентаря.
 */
export const WEAPONS = {
  /* ---------------------------------------------------------- БЛИЖНІ */
  arc: {
    id: 'arc', kind: 'melee', name: 'АРК-ТЕСАК', sprite: 'w_arc',
    desc: 'Комбо з трьох ударів, парирує ворожі кулі, на повній шкалі — розряд по колу.',
    from: 'старт', unlock: { type: 'start' },
    dmg: [2, 2, 3], reach: 19, swing: [0.18, 0.18, 0.30], res: 'заряд клинка',
    bars: { dmg: 3, spd: 4, rng: 2 }
  },
  whip: {
    id: 'whip', kind: 'melee', name: 'ЕЛЕКТРОХЛИСТ', sprite: 'w_whip',
    desc: 'Найдовший ближній: б\'є дугою всіх одразу, оглушує і перестрибує на сусіда.',
    from: 'секрет на секторі 3', unlock: { type: 'level', n: 2 },
    dmg: [1.2], reach: 56, swing: [0.26], res: 'нема',
    bars: { dmg: 2, spd: 3, rng: 5 }
  },
  brand: {
    id: 'brand', kind: 'melee', name: 'ТАВРО', sprite: 'w_brand',
    desc: 'Повільна грав-рукавиця: збиває з ніг, кидає легких ворогів і ламає тріснуті блоки.',
    from: 'нагорода за Сервотавра', unlock: { type: 'boss', n: 1 },
    dmg: [3], reach: 22, swing: [0.45], res: 'нема',
    bars: { dmg: 5, spd: 1, rng: 2 }
  },
  chrono: {
    id: 'chrono', kind: 'melee', name: 'ХРОНОРІЗ', sprite: 'w_chrono',
    desc: 'Телепорт крізь ворога й удар у спину: подвійна шкода, щити не рахуються.',
    from: 'нагорода за Хроноклинка', unlock: { type: 'boss', n: 5 },
    dmg: [2], reach: 44, swing: [0.22], res: 'кулдаун 1,2 с',
    bars: { dmg: 4, spd: 3, rng: 4 }
  },
  claws: {
    id: 'claws', kind: 'melee', name: 'ПЛАЗМОВІ КІГТІ', sprite: 'w_claws',
    desc: 'Впритул і без ліміту комбо: кожне влучання гріє ворога, п\'ятий стак — вибух.',
    from: 'секрет на секторі 7', unlock: { type: 'level', n: 6 },
    dmg: [1.3], reach: 12, swing: [0.10], res: 'нема',
    bars: { dmg: 1, spd: 5, rng: 1 }
  },

  /* ---------------------------------------------------------- ДАЛЬНІ */
  rail: {
    id: 'rail', kind: 'ranged', name: 'РЕЙКОСТРИЛ', sprite: 'w_rail',
    desc: 'Замість набоїв — тепло: перегрів, активне перезаряджання, пробивний заряд.',
    from: 'старт', unlock: { type: 'start' },
    dmg: 1, res: 'тепло', bars: { dmg: 3, spd: 3, rng: 4 }
  },
  osa: {
    id: 'osa', kind: 'ranged', name: 'ПІСТОЛЕТ «ОСА»', sprite: 'w_osa',
    desc: 'Куля сама доводиться до цілі в конусі 40°, але щити й броню майже не бере.',
    from: 'секрет на секторі 1', unlock: { type: 'level', n: 0 },
    dmg: 0.35, res: 'нескінченні', bars: { dmg: 1, spd: 5, rng: 3 }
  },
  swarm: {
    id: 'swarm', kind: 'ranged', name: 'РІЙ', sprite: 'w_swarm',
    desc: 'Позначає ціль — три дрони б\'ють її самі, поки ти ухиляєшся.',
    from: 'нагорода за Матку-Рій', unlock: { type: 'boss', n: 3 },
    dmg: 0.85, res: 'дрони', bars: { dmg: 3, spd: 2, rng: 4 }
  },
  shot: {
    id: 'shot', kind: 'ranged', name: 'ДРОБОВИК «КАРТЕЧ»', sprite: 'w_shot',
    desc: 'Шість дробин конусом: впритул зносить, здалеку не бере, віддача підкидає в повітрі.',
    from: 'секрет на секторі 5', unlock: { type: 'level', n: 4 },
    dmg: 0.4, res: 'набої', bars: { dmg: 5, spd: 2, rng: 1 }
  },
  glitch: {
    id: 'glitch', kind: 'ranged', name: 'ГЛІЧ-КОД', sprite: 'w_glitch',
    desc: 'Перехоплює ворога — той шість секунд б\'ється за тебе; боса глушить на 1,5 с.',
    from: 'нагорода за Гліч-Ядро', unlock: { type: 'boss', n: 7 },
    dmg: 0, res: 'ядра', bars: { dmg: 2, spd: 2, rng: 3 }
  }
};
export const MELEE_IDS = ['arc', 'whip', 'brand', 'chrono', 'claws'];
export const RANGED_IDS = ['rail', 'osa', 'swarm', 'shot', 'glitch'];

/** Яку зброю дає секрет на конкретному рівні. */
export const LEVEL_LOOT = { 0: 'osa', 2: 'whip', 4: 'shot', 6: 'claws' };
/** Яку зброю дає бос конкретного рівня. */
export const BOSS_LOOT = { 1: 'brand', 3: 'swarm', 5: 'chrono', 7: 'glitch' };

export function unlockText(w) {
  if (w.unlock.type === 'level') return 'Знайти на секторі ' + (w.unlock.n + 1);
  if (w.unlock.type === 'boss') return 'Нагорода за боса ' + (w.unlock.n + 1);
  return 'Доступна одразу';
}
