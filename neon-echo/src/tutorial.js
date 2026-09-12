/**
 * Навчання — грою, а не текстом.
 *
 * Жодної стіни тексту й жодного окремого «рівня-туторіалу»: підказки
 * живуть у перших двох-трьох екранах сектора 1, з'являються САМЕ ТОДІ,
 * коли дія вперше потрібна, і зникають, щойно її виконано. Підказка —
 * це голограма з анімацією дії плюс іконка кнопки; слів у ній рівно
 * стільки, щоб назвати дію.
 *
 * Навчання можна пропустити на першому запуску й повернутись до нього
 * з меню будь-коли. Воно нічого не блокує — крім одного місця:
 * парирування. Це головна механіка гри й найважча для розуміння, тож
 * там стоїть коротке тренування з живим ворогом. Але й воно
 * пропускається після п'яти невдалих спроб: ніхто не має застрягти в
 * навчанні назавжди.
 *
 * Модуль не імпортує core.js — усе, що йому потрібно, приходить
 * в `api`. Так навчання можна прогнати тестом без запуску всієї гри.
 */

/**
 * Крок навчання.
 *   id    — ключ, за ним же зберігається «цей уже бачили»
 *   btn   — яку кнопку показати в голограмі
 *   holo  — анімація дії (малює render/index.js)
 *   text  — один рядок, не абзац
 *   at    — коли показувати: частка довжини перших трьох екранів
 *   need  — що має статись, щоб підказка зникла
 */
export const STEPS = [
  { id: 'move',  btn: '←→', el: 'dpad',  holo: 'tMove',
    task: 'Іди вправо',                          need: 'moved' },
  { id: 'jump',  btn: 'A',  el: 'btnA',  holo: 'tJump',
    task: 'Стрибни через прірву',                need: 'jumped' },
  { id: 'blade', btn: 'B',  el: 'btnB',  holo: 'tBlade',
    task: 'Удар клинком',                        need: 'hitMelee' },
  { id: 'dash',  btn: 'D',  el: 'btnD',  holo: 'tDash',
    task: 'Ривок — під час нього ти невразлива',  need: 'dashed' },
  { id: 'shoot', btn: 'C',  el: 'btnC',  holo: 'tShoot',
    task: 'Постріл дальньою зброєю',             need: 'shot' },
  { id: 'heat',  btn: 'C',  el: 'btnC',  holo: 'tHeat',
    task: 'Перегрів: тапни C у зеленій зоні шкали', need: 'cooled' },
  { id: 'parry', btn: 'B',  el: 'btnB',  holo: 'tParry', long: 1,
    task: 'Парирування: тисни B за мить ДО кулі', need: 'parried2' },
  { id: 'cp',    btn: '',   el: '',      holo: 'tCp',
    task: 'Стань на чекпоінт',                   need: 'checkpoint' },
  { id: 'inv',   btn: '',   el: 'btnPause', holo: 'tInv',
    task: 'Пауза → Арсенал: зміни зброю',        need: 'invSeen' }
];

/** Скільки невдалих спроб до появи «Пропустити цей крок». */
export const SKIP_AFTER = 5;

/** Скільки вдалих парирувань треба, щоб пройти тренування. */
export const PARRY_NEED = 2;
/** Після скількох невдалих спроб дається пропуск. */
export const PARRY_GIVEUP = 5;

/**
 * Коротка підказка до кожної зброї — показується один раз, коли зброю
 * видали за сектор. Механіка в один рядок, а не опис на абзац.
 */
export const WEAPON_TIP = {
  arc:    'Комбо з трьох ударів. Третій — найсильніший.',
  whip:   'Дуга б\'є по всіх, хто в ній стоїть, — не цілься в одного.',
  brand:  'Утримай B — важкий удар і хвиля по підлозі.',
  chrono: 'Б\'є КРІЗЬ щит: телепорт за спину замість обходу.',
  claws:  'Найвищий DPS, але тільки впритул. Стаки перегріву горять.',
  rail:   'Набоїв немає — є тепло. Перегрів блокує зброю на 2 с.',
  osa:    'Самонаведення. Стріляй, не цілячись, і тримай дистанцію.',
  swarm:  'Дрони самі шукають ціль і живуть окремо від тебе.',
  shot:   'Упритул — найсильніша зброя в грі. З 3 метрів — найслабша.',
  glitch: 'Шкоди не завдає: перехоплює ворога на 6 с і робить союзником.',
  prism:  'Промінь відбивається від стін. У коридорі — найсильніша.'
};

/**
 * Драйвер навчання. `api` дає доступ до стану гри, тож сам модуль
 * нічого не знає ні про core.js, ні про рендер.
 */
export function makeTutorial(api) {
  const st = {
    on: false,          // навчання йде
    i: 0,               // індекс поточного кроку
    step: null,         // сам крок
    t: 0,               // скільки він уже триває
    tries: 0,           // невдалих спроб на цьому кроці
    canSkip: 0,         // чи показувати «Пропустити цей крок»
    done: {},           // що вже виконано
    parryOk: 0, parryMiss: 0, parrySkip: 0,
    finished: 0,        // навчання дійшло до кінця
    tipId: null, tipT: 0
  };

  /** Починає крок i: чистить лічильники й готує сцену. */
  function enter(i) {
    st.i = i;
    st.step = STEPS[i] || null;
    st.t = 0; st.tries = 0; st.canSkip = 0;
    if (!st.step) { stop(true); return; }
    // Кожен крок починається з чистого аркуша: ворогів і куль на
    // ділянці немає взагалі, тож помилка нічого не коштує.
    api.clearField();
    if (st.step.id === 'parry') { st.parryOk = 0; st.parryMiss = 0; st.parrySkip = 0; api.startParryDrill(); }
    api.showStep(st.step, i + 1, STEPS.length);
  }

  function start(fromMenu) {
    st.on = true; st.done = {}; st.finished = 0;
    api.setSeen([]);
    if (fromMenu) api.startLevel(0, false);
    enter(0);
  }
  function stop(completed) {
    st.on = false; st.step = null;
    api.clearHint();
    api.endParryDrill();
    if (completed) { st.finished = 1; api.markDone(); api.finish(); }
  }
  /** Вихід одним тапом — із будь-якого місця. */
  function quit() { stop(false); api.quit(); }
  /** Повторити поточний крок. */
  function repeat() { if (st.on && st.step) enter(st.i); }
  /** Пропустити крок. Стає доступним після п'яти невдалих спроб. */
  function skip() {
    if (!st.on || !st.step) return;
    api.seen(st.step.id);
    if (st.step.id === 'parry') api.endParryDrill();
    if (st.i + 1 >= STEPS.length) { stop(true); return; }
    enter(st.i + 1);
  }

  /** Чи виконано умову кроку. */
  function satisfied(need) {
    const g = api.state();
    switch (need) {
      case 'moved':      return Math.abs(g.px - g.stepX) > g.tile * 4;
      // Саме НАТИСНУТИЙ стрибок, а не `P.jumps > 0`: лічильник стрибків
      // стає одиницею й тоді, коли просто зійшла з краю платформи.
      case 'jumped':     return !!st.done.jumped;
      case 'hitMelee':   return !!st.done.hitMelee;
      case 'dashed':     return !!st.done.dashed;
      case 'shot':       return !!st.done.shot;
      case 'cooled':     return !!st.done.cooled;
      case 'parried2':   return st.parryOk >= PARRY_NEED || st.parrySkip;
      case 'checkpoint': return g.cpTaken;
      case 'invSeen':    return !!st.done.invSeen;
    }
    return true;
  }

  /** Викликається з геймплею на кожну помітну дію. */
  function note(what) {
    if (!st.on) return;
    if (what === 'parryOk') { st.parryOk++; return; }
    if (what === 'parryMiss') { st.parryMiss++; fail(); return; }
    st.done[what] = 1;
  }
  /** Невдала спроба: п'ять таких — і з'являється пропуск. */
  function fail() {
    if (!st.on || !st.step) return;
    st.tries++;
    if (st.tries >= SKIP_AFTER && !st.canSkip) {
      st.canSkip = 1;
      api.offerSkip();
    }
  }

  function update(dt) {
    if (st.tipT > 0) { st.tipT -= dt; if (st.tipT <= 0) st.tipId = null; }
    if (!st.on || !st.step) return;
    const g = api.state();
    if (g.state !== 'play') return;
    st.t += dt;

    // Поки крок не виконано — далі не йдемо. Межа видима, а не невидима.
    if (st.step.id === 'parry') {
      if (!st.parrySkip && st.parryOk < PARRY_NEED) api.gate(g.stepX + g.tile * 8);
      else api.gate(0);
    } else if (st.step.need !== 'moved' && st.step.need !== 'checkpoint') {
      api.gate(g.stepX + g.tile * 8);
    } else api.gate(0);

    api.hint(st.step, api.hintPos());

    if (satisfied(st.step.need)) {
      api.seen(st.step.id);
      api.ding();
      if (st.step.id === 'parry') api.endParryDrill();
      api.gate(0);
      if (st.i + 1 >= STEPS.length) { stop(true); return; }
      enter(st.i + 1);
    }
  }

  /** Коротка підказка до нової зброї — один раз на зброю. */
  function weaponTip(id) {
    if (!WEAPON_TIP[id] || api.seenHas('w_' + id)) return;
    api.seen('w_' + id);
    st.tipId = id; st.tipT = 4.5;
  }

  return {
    st: st,
    start: start,
    stop: stop,
    quit: quit,
    repeat: repeat,
    skip: skip,
    fail: fail,
    update: update,
    note: note,
    weaponTip: weaponTip,
    steps: STEPS,
    get tip() { return st.tipId ? WEAPON_TIP[st.tipId] : null; },
    get active() { return st.on; },
    get stepNo() { return st.i + 1; },
    get total() { return STEPS.length; }
  };
}
