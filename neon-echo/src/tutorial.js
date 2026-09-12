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
  { id: 'move',  btn: '←→', holo: 'tMove',  text: 'РУХ',                at: 0.00, need: 'moved' },
  { id: 'jump',  btn: 'A',  holo: 'tJump',  text: 'СТРИБОК',            at: 0.16, need: 'jumped' },
  { id: 'djump', btn: 'A',  holo: 'tDjump', text: 'ДРУГИЙ ТАП У ПОВІТРІ — ПОДВІЙНИЙ', at: 0.26, need: 'djumped' },
  { id: 'blade', btn: 'B',  holo: 'tBlade', text: 'КЛИНОК',             at: 0.38, need: 'hitMelee' },
  { id: 'dash',  btn: 'D',  holo: 'tDash',  text: 'РИВОК — ПІД ЧАС НЬОГО ТИ НЕВРАЗЛИВА', at: 0.50, need: 'dashed' },
  { id: 'shoot', btn: 'C',  holo: 'tShoot', text: 'ДАЛЬНЯ ЗБРОЯ',       at: 0.62, need: 'shot' },
  { id: 'heat',  btn: 'C',  holo: 'tHeat',  text: 'ПЕРЕГРІВ: ТАП У ЗЕЛЕНІЙ ЗОНІ СКИДАЄ ТЕПЛО', at: 0.70, need: 'cooled' },
  { id: 'parry', btn: 'B',  holo: 'tParry', text: 'ПАРИРУВАННЯ: B ЗА МИТЬ ДО КУЛІ', at: 0.80, need: 'parried2' },
  { id: 'cp',    btn: '',   holo: 'tCp',    text: 'ЧЕКПОІНТ — ТУТ ТИ ВІДРОДИШСЯ',  at: 0.92, need: 'checkpoint' },
  { id: 'inv',   btn: '',   holo: 'tInv',   text: 'НА ЧЕКПОІНТІ МОЖНА ЗМІНИТИ ЗБРОЮ', at: 0.94, need: 'invSeen' }
];

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
    i: 0,               // поточний крок
    step: null,         // об'єкт кроку
    shownT: 0,          // скільки підказка вже висить
    done: {},           // що вже виконано
    parryOk: 0, parryMiss: 0, parryGate: 0, parrySkip: 0,
    tipId: null, tipT: 0
  };

  function start(fromMenu) {
    st.on = true; st.i = 0; st.step = null; st.shownT = 0;
    st.done = {}; st.parryOk = 0; st.parryMiss = 0; st.parryGate = 0; st.parrySkip = 0;
    api.setSeen([]);
    if (fromMenu) api.startLevel(0, false);
  }
  function stop(completed) {
    st.on = false; st.step = null;
    api.clearHint();
    if (completed) api.markDone();
  }

  /** Чи виконано умову кроку. Усе — з реального стану гри, без окремих лічильників. */
  function satisfied(need) {
    const g = api.state();
    switch (need) {
      case 'moved':      return Math.abs(g.px - g.spawnX) > g.tile * 3;
      // Саме НАТИСНУТИЙ стрибок, а не `P.jumps > 0`: лічильник стрибків
      // стає одиницею й тоді, коли просто зійшла з краю платформи, —
      // і підказка гасла б, хоча кнопки ніхто не торкався.
      case 'jumped':     return !!st.done.jumped;
      case 'djumped':    return st.done.djumped;
      case 'hitMelee':   return st.done.hitMelee;
      case 'dashed':     return st.done.dashed;
      case 'shot':       return st.done.shot;
      case 'cooled':     return st.done.cooled;
      case 'parried2':   return st.parryOk >= PARRY_NEED || st.parrySkip;
      case 'checkpoint': return g.cpTaken;
      case 'invSeen':    return st.done.invSeen;
    }
    return true;
  }

  /** Викликається з геймплею на кожну помітну дію. */
  function note(what) {
    if (!st.on) return;
    if (what === 'parryOk') { st.parryOk++; return; }
    if (what === 'parryMiss') { st.parryMiss++; return; }
    st.done[what] = 1;
  }

  function update(dt) {
    if (st.tipT > 0) { st.tipT -= dt; if (st.tipT <= 0) st.tipId = null; }
    if (!st.on) return;
    const g = api.state();
    if (g.level !== 0 || g.state !== 'play') return;

    // Крок уже виконано — гасимо підказку й беремо наступний.
    if (st.step && satisfied(st.step.need)) {
      api.seen(st.step.id);
      if (st.step.id === 'parry') api.endParryDrill();
      st.step = null; st.i++;
      api.clearHint();
      api.ding();
      if (st.i >= STEPS.length) { stop(true); return; }
    }
    if (st.step) {
      st.shownT += dt;
      api.hint(st.step, api.hintPos());
      if (st.step.id === 'parry') parryDrill(dt);
      return;
    }
    // Наступний крок вмикається, коли героїня дійшла до його місця.
    const next = STEPS[st.i];
    if (!next) { stop(true); return; }
    if (g.px >= g.tutorSpan * next.at) {
      st.step = next; st.shownT = 0;
      api.ding();
      if (next.id === 'parry') { st.parryGate = g.px + g.tile * 6; api.startParryDrill(); }
    }
  }

  /* Тренування парирування. Ворог стріляє ПОВІЛЬНИМИ кулями по колу —
     ритм читається з першого разу, і можна спробувати ще, не гинучи.
     Далі не пускаємо, поки не паріювала двічі... але після п'яти
     невдач відкриваємо прохід самі: навчання не має ставати стіною. */
  function parryDrill(dt) {
    const g = api.state();
    if (st.parryMiss >= PARRY_GIVEUP && !st.parrySkip) {
      st.parrySkip = 1;
      api.say('МОЖНА ЙТИ ДАЛІ — ПАРИРУВАННЯ ЧЕКАЄ В ТРЕНУВАЛЬНІЙ КІМНАТІ');
    }
    if (!st.parrySkip && st.parryOk < PARRY_NEED) api.gate(st.parryGate);
    else api.gate(0);
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
    update: update,
    note: note,
    weaponTip: weaponTip,
    get tip() { return st.tipId ? WEAPON_TIP[st.tipId] : null; },
    get active() { return st.on; }
  };
}
