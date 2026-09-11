import { S, HIT } from './config.js';

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
    dmg: [HIT, HIT, HIT * 1.5], reach: S(26), swing: [0.18, 0.18, 0.30], res: 'заряд клинка',
    bars: { dmg: 3, spd: 4, rng: 2 },
    hint: 'B — комбо з трьох ударів; натисни B за мить до кулі, щоб відбити її назад.'
  },
  whip: {
    id: 'whip', kind: 'melee', name: 'ЕЛЕКТРОХЛИСТ', sprite: 'w_whip',
    desc: 'Найдовший ближній: б\'є дугою всіх одразу, оглушує і перестрибує на сусіда.',
    from: 'секрет на секторі 3', unlock: { type: 'level', n: 2 },
    dmg: [9], reach: S(76), swing: [0.45], res: 'нема',
    bars: { dmg: 2, spd: 3, rng: 5 },
    hint: 'B — дуга на 56 px б\'є всіх одразу й перестрибує на сусіда.'
  },
  brand: {
    id: 'brand', kind: 'melee', name: 'ТАВРО', sprite: 'w_brand',
    desc: 'Повільна грав-рукавиця: збиває з ніг, кидає легких ворогів і ламає тріснуті блоки.',
    from: 'нагорода за Сервотавра', unlock: { type: 'boss', n: 1 },
    dmg: [15], reach: S(30), swing: [0.45], res: 'нема',
    bars: { dmg: 5, spd: 1, rng: 2 },
    hint: 'B — важкий удар; утримай B на землі, щоб пустити ударну хвилю.'
  },
  chrono: {
    id: 'chrono', kind: 'melee', name: 'ХРОНОРІЗ', sprite: 'w_chrono',
    desc: 'Телепорт крізь ворога й удар у спину: подвійна шкода, щити не рахуються.',
    from: 'нагорода за Хроноклинка', unlock: { type: 'boss', n: 5 },
    dmg: [HIT], reach: S(59), swing: [0.22], res: 'кулдаун 1,2 с',
    bars: { dmg: 4, spd: 3, rng: 4 },
    hint: 'B біля ворога — телепорт йому за спину крізь щит.'
  },
  claws: {
    id: 'claws', kind: 'melee', name: 'ПЛАЗМОВІ КІГТІ', sprite: 'w_claws',
    desc: 'Найкоротша дистанція й найшвидші удари: кожне влучання гріє ворога, п\'ятий стак — вибух.',
    from: 'секрет на секторі 7', unlock: { type: 'level', n: 6 },
    dmg: [6.5], reach: S(22), swing: [0.10], res: 'нема',
    bars: { dmg: 1, spd: 5, rng: 1 },
    hint: 'B — найшвидші удари в грі, п\'ятий стак підпалює ворога.'
  },

  /* ---------------------------------------------------------- ДАЛЬНІ */
  rail: {
    id: 'rail', kind: 'ranged', name: 'РЕЙКОСТРИЛ', sprite: 'w_rail',
    desc: 'Замість набоїв — тепло: перегрів, активне перезаряджання, пробивний заряд.',
    from: 'старт', unlock: { type: 'start' },
    dmg: HIT, res: 'тепло', bars: { dmg: 3, spd: 3, rng: 4 },
    hint: 'C — постріл; утримай C 0,8 с для пробивного заряду; тап у зеленій зоні гасить перегрів.'
  },
  osa: {
    id: 'osa', kind: 'ranged', name: 'ПІСТОЛЕТ «ОСА»', sprite: 'w_osa',
    desc: 'Куля сама доводиться до цілі в конусі 40°, але щити й броню майже не бере.',
    from: 'секрет на секторі 1', unlock: { type: 'level', n: 0 },
    dmg: 3.5, res: 'нескінченні', bars: { dmg: 1, spd: 5, rng: 3 },
    hint: 'C — куля сама доводиться до цілі, цілитись не треба.'
  },
  swarm: {
    id: 'swarm', kind: 'ranged', name: 'РІЙ', sprite: 'w_swarm',
    desc: 'Позначає ціль — три дрони б\'ють її самі, поки ти ухиляєшся.',
    from: 'нагорода за Матку-Рій', unlock: { type: 'boss', n: 3 },
    dmg: 4.25, res: 'дрони', bars: { dmg: 3, spd: 2, rng: 4 },
    hint: 'C — позначає ціль, три дрони б\'ють її самі.'
  },
  shot: {
    id: 'shot', kind: 'ranged', name: 'ДРОБОВИК «КАРТЕЧ»', sprite: 'w_shot',
    desc: 'Шість дробин по 8: упритул влучають усі шість — 48 за постріл, учетверо більше за пістолет.',
    from: 'секрет на секторі 5', unlock: { type: 'level', n: 4 },
    dmg: 8, res: 'набої', bars: { dmg: 5, spd: 2, rng: 1 },
    hint: 'C — впритул зносить; у повітрі віддача працює як другий стрибок.'
  },
  glitch: {
    id: 'glitch', kind: 'ranged', name: 'ГЛІЧ-КОД', sprite: 'w_glitch',
    desc: 'Перехоплює ворога — той шість секунд б\'ється за тебе; боса глушить на 1,5 с.',
    from: 'нагорода за Гліч-Ядро', unlock: { type: 'boss', n: 7 },
    dmg: 0, res: 'ядра', bars: { dmg: 2, spd: 2, rng: 3 },
    hint: 'C — влучив у ворога, і той шість секунд твій.'
  },
  prism: {
    id: 'prism', kind: 'ranged', name: 'ЕХО-ПРИЗМА', sprite: 'w_prism',
    desc: 'Промінь відбивається від стін до п\'яти разів і на кожному відбитті роздвоюється.',
    from: 'три фрагменти на секторах 3, 6 і 9', unlock: { type: 'frags' },
    dmg: 3.5, res: 'ядра', bars: { dmg: 5, spd: 3, rng: 5 },
    hint: 'C — у коридорі це м\'ясорубка, на відкритому місці майже марна.'
  }
};
export const MELEE_IDS = ['arc', 'whip', 'brand', 'chrono', 'claws'];
export const RANGED_IDS = ['rail', 'osa', 'swarm', 'shot', 'glitch', 'prism'];

/**
 * Нагорода за ПРОХОДЖЕННЯ рівня — видається на екрані завершення, а не
 * лежить по закутках. Ключ — індекс рівня (0..9).
 */
export const LEVEL_REWARD = {
  0: { kind: 'weapon', id: 'osa' },
  1: { kind: 'weapon', id: 'brand' },
  2: { kind: 'weapon', id: 'whip' },
  3: { kind: 'weapon', id: 'swarm' },
  4: { kind: 'weapon', id: 'shot' },
  5: { kind: 'weapon', id: 'chrono' },
  6: { kind: 'weapon', id: 'claws' },
  7: { kind: 'weapon', id: 'glitch' },
  8: { kind: 'heart', name: 'МОДУЛЬ «ДРУГЕ ДИХАННЯ»', sprite: 'w_heartmod',
       desc: 'Резервний контур живлення: +1 серце назавжди, у всіх наступних забігах.',
       hint: 'Працює одразу — шкала сердець стала довшою.' },
  9: { kind: 'key', name: 'КЛЮЧ АРХІТЕКТОРА', sprite: 'w_key',
       desc: 'Кореневий доступ до Кайзен-Вольт. Відкриває НОВУ ГРУ+ із усім арсеналом.',
       hint: 'У головному меню з\'явився пункт «НОВА ГРА+».' }
};
/** Секретні фрагменти Ехо-Призми: на яких рівнях їх сховано. */
export const FRAG_LEVELS = [2, 5, 8];

/** Де саме видають зброю — для екрана арсеналу. */
export function unlockText(w) {
  if (w.unlock.type === 'frags') return 'Зібрати три фрагменти на секторах 3, 6 і 9';
  for (const [lvl, r] of Object.entries(LEVEL_REWARD))
    if (r.kind === 'weapon' && r.id === w.id) return 'Нагорода за сектор ' + (+lvl + 1);
  return 'Доступна одразу';
}
