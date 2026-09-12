/** Екрани меню (DOM поверх канви) і прив'язка налаштувань. */
import { Store } from './store.js';
import { Pad, ELEMS, ELNAME, ELBASE, PRESETS } from './pad.js';
import { Sfx, applyVolume, buzz, Music } from './audio.js';
import { Input } from './input.js';
import { Game, hooks, LEVELS, canSwapNow, refreshEquip, fragCount } from './core.js';
import { WEAPONS, MELEE_IDS, RANGED_IDS, unlockText } from './weapons.js';
import { Gfx } from './render/index.js';

const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'levels', 'settings', 'controls', 'inv', 'reward', 'assist', 'about', 'pause', 'dead', 'clear', 'win', 'tutask', 'rangeSet', 'tutdone'];
export let curScreen = 'menu';

export function showScreen(id) {
  curScreen = id;
  for (const s of SCREENS) $(s).classList.toggle('on', s === id);
  Input.setPreview(id === 'controls', onDragged, selectElem);   // редактор розкладки
  Input.enable(id === null || id === undefined);
  // Кнопка DBG живе поза шаром керування, тож сама не зникає — а поверх
  // меню вона перекриває його верхній правий кут (і саме це було видно
  // на скріншоті налаштувань).
  document.body.classList.toggle('menuOpen', id !== null && id !== undefined && id !== 'controls');
  if (id === 'settings') requestAnimationFrame(fadeSync);
  // Смужки кімнати й навчання видимі, лише поки жоден екран не заважає.
  const inGame = id === null || id === undefined;
  const bar = $('rangeBar');
  if (bar) bar.hidden = !(Game.range && inGame);
  const tb = $('tutBar');
  if (tb) tb.hidden = !(Game.tutInfo && Game.tutInfo().on && inGame);
}

/* ========================================================== НАВЧАННЯ
   Смуга показує, ЯКИЙ це крок і що саме треба зробити, а потрібна
   кнопка пульсує на самому інтерфейсі. Читати не треба — видно. */
function tutPulse(elId) {
  for (const id of ['dpad', 'btnA', 'btnB', 'btnC', 'btnD', 'btnPause']) {
    const e = $(id);
    if (e) e.classList.toggle('tutWant', !!elId && id === elId);
  }
}
export function tutShow(step) {
  const tb = $('tutBar');
  if (!step) { if (tb) tb.hidden = true; tutPulse(null); return; }
  tb.hidden = false;
  $('tbNo').textContent = 'КРОК ' + step.n + ' З ' + step.total;
  $('tbTask').textContent = step.task;
  $('tbSkip').hidden = true;          // з'явиться після п'яти невдач
  tutPulse(step.el);
}
function initTutorialBar() {
  $('tbRepeat').addEventListener('click', () => { Sfx.ui(); Game.tutRepeat(); });
  $('tbSkip').addEventListener('click', () => { Sfx.ui(); Game.tutSkip(); });
  $('tbQuit').addEventListener('click', () => { Sfx.ui(); Game.tutQuit(); });
  $('tdRange').addEventListener('click', () => { Sfx.ui(); Game.startRange('menu'); });
  $('tdPlay').addEventListener('click', () => { Sfx.ui(); Game.startLevel(0, false); });
}
function updateProgressLabel() {
  $('mProg').textContent = 'ВІДКРИТО СЕКТОРІВ: ' + Store.data.unlocked + ' / ' + LEVELS.length;
  $('mPlay').textContent = Store.data.unlocked > 1 ? 'Продовжити' : 'Грати';
  const f = fragCount();
  const has = Store.data.owned.indexOf('prism') >= 0;
  $('mFrag').textContent = has ? 'ЕХО-ПРИЗМА ЗІБРАНА' : 'ФРАГМЕНТИ ПРИЗМИ: ' + f + ' / 3';
  $('mFrag').style.color = (has || f >= 3) ? 'var(--cyan)' : '';
  $('mNG').hidden = !Store.data.ngKey;
}

/* ------------------------------------------------ СЦЕНА НАГОРОДИ
   Дві секунди спрайт обертається в променях, поки читається назва й
   механіка; далі — «Екіпірувати зараз / Пізніше». Для не-зброї (серце,
   ключ) кнопок нема, лише «Далі». */
let rewardNext = null, rewardT = null;
function showReward(r, next) {
  if (!r) { next(); return; }
  rewardNext = next;
  $('rwKicker').textContent = r.kind === 'weapon' ? 'НОВА ЗБРОЯ' : 'НАГОРОДА';
  $('rwName').textContent = r.name;
  $('rwDesc').textContent = r.desc;
  $('rwHint').textContent = r.hint || '';
  $('rwImg').src = 'assets/wpn/' + r.sprite.replace(/^w_/, '') + '.png';
  const weapon = r.kind === 'weapon';
  $('rwEquip').hidden = !weapon;
  $('rwEquip').textContent = 'Екіпірувати зараз';
  $('rwLater').textContent = weapon ? 'Пізніше' : 'Далі';
  $('rwBtns').style.visibility = 'hidden';        // спершу сцена, потім вибір
  showScreen('reward');
  Sfx.win();
  clearTimeout(rewardT);
  rewardT = setTimeout(() => { $('rwBtns').style.visibility = 'visible'; }, 2000);
  $('rwEquip').onclick = () => {
    Sfx.ui();
    if (r.slot === 'melee') Store.data.melee = r.id; else Store.data.ranged = r.id;
    Store.save(); refreshEquip();
    finishReward();
  };
  $('rwLater').onclick = () => { Sfx.ui(); finishReward(); };
}
function finishReward() {
  clearTimeout(rewardT);
  const n = rewardNext; rewardNext = null;
  if (n) n();
}
function buildLevelGrid() {
  const g = $('lvGrid');
  g.innerHTML = '';
  for (let i = 0; i < LEVELS.length; i++) {
    const b = document.createElement('button');
    const open = (i + 1) <= Store.data.unlocked;
    const done = Store.data.cleared.indexOf(i) >= 0;
    b.className = 'lvl' + (done ? ' done' : '') + (open ? '' : ' lock');
    b.innerHTML = (open ? (i + 1) : '🔒') + '<b>' + (open ? LEVELS[i].n.split(' ')[0] : 'ЗАКРИТО') + '</b>';
    if (open) b.addEventListener('click', () => { Sfx.ui(); Game.startLevel(i, false); });
    else b.disabled = true;
    g.appendChild(b);
  }
}
function segBind(id, fn, sync) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    Sfx.ui(); fn(b.getAttribute('data-v')); Store.save(); (sync || syncSettings)();
  });
}
function segSet(id, val) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.getAttribute('data-v') === val);
}
/* ==================================================== ЕКРАН НАЛАШТУВАНЬ
   П'ять вкладок замість суцільного списку: у кожній 4-8 пунктів, і в
   горизонталі вони лягають у дві колонки. Шапка з «Назад» закріплена,
   прокручується лише тіло. */
const TABS = ['ctl', 'gfx', 'snd', 'game', 'dev'];
let curTab = 'ctl';
const tabScroll = { ctl: 0, gfx: 0, snd: 0, game: 0, dev: 0 };

/** Смужка «нижче ще є» гасне рівно на дні. */
function fadeSync() {
  const b = $('sBody'), f = $('sFade');
  if (!b || !f) return;
  f.classList.toggle('on', b.scrollHeight - b.scrollTop - b.clientHeight > 4);
}
export function setTab(t) {
  if (TABS.indexOf(t) < 0) t = 'ctl';
  const b = $('sBody');
  if (b && curTab !== t) tabScroll[curTab] = b.scrollTop;   // запам'ятали, де були
  curTab = t;
  for (const btn of $('sTabs').querySelectorAll('button'))
    btn.classList.toggle('on', btn.getAttribute('data-v') === t);
  for (const p of $('sBody').querySelectorAll('.pane'))
    p.classList.toggle('on', p.getAttribute('data-p') === t);
  if (b) { b.scrollTop = tabScroll[t] || 0; requestAnimationFrame(fadeSync); }
}

export function syncSettings() {
  $('sVol').value = Store.data.vol; $('vVol').textContent = Store.data.vol + '%';
  $('sMus').value = Store.data.mus; $('vMus').textContent = Store.data.mus + '%';
  $('sTrack').textContent = Music.title || '—';
  segSet('sGfx', Store.data.gfx);
  segSet('sCam', String(Store.data.cam));
  segSet('sDim', String(Store.data.dimFight));
  segSet('sCrt', String(Store.data.crt));
  segSet('sOut', String(Store.data.outline));
  segSet('sDbg', String(Store.data.dbg));
  segSet('sDiff', Store.data.diff || 'normal');
  segSet('cVib', String(Store.data.vib));
  segSet('cHand', String(Pad.hand));
  segSet('sProf', String(Pad.state.prof));
  $('sBloom').value = Store.data.bloom; $('vBloom').textContent = Store.data.bloom + '%';
  $('sAb').value = Store.data.ab; $('vAb').textContent = Store.data.ab + '%';
  $('sBg').value = Store.data.bgDim; $('vBg').textContent = Store.data.bgDim + '%';
  $('sDiffHint').textContent = DIFF_HINT[Store.data.diff || 'normal'];
  $('sTut').textContent = Store.data.tutDone ? 'Пройти навчання ще раз' : 'Пройти навчання';
}
const DIFF_HINT = {
  easy:   'У босів прибрано найважчий патерн, телеграфи довші на 40%, вікна вразливості — на 50%. HP босів той самий.',
  normal: 'Еталон: усі патерни, штатні телеграфи й вікна.',
  hard:   'Кожен бос отримує ОКРЕМУ нову механіку, вікна вразливості коротші на 25%, лють із 90 с. Парирування вужче, але відбита куля б\'є втричі сильніше.'
};


/* ================================================= РЕДАКТОР РОЗКЛАДКИ
   Кожен елемент — окремо: позиція, розмір, прозорість, форма, підпис,
   вібрація, видимість. Гра лишається на фоні, кнопки в реальному
   вигляді лежать поверх, тап вибирає, протяг переносить. */
let selEl = null, testing = false;
const SHAPES = {
  tri: [['tri', 'Трикутник'], ['square', 'Плитка'], ['round', 'Коло']],
  btn: [['round', 'Коло'], ['square', 'Квадрат']]
};

function elName(k) { return ELNAME[k] || k; }
function shapeSetFor(k) { return (k === 'L' || k === 'R') ? SHAPES.tri : SHAPES.btn; }

export function selectElem(k) {
  selEl = k;
  Input.select(k);
  const panel = $('cPanel');
  if (!k) { panel.hidden = true; panel.style.maxHeight = ''; syncControls(); return; }
  panel.hidden = false;
  // Панель іде на протилежну половину екрана від самої кнопки, щоб та
  // лишалась на очах, поки її крутять повзунками.
  placePanel(panel, k);
  const c = Pad.el(k), base = ELBASE[k];
  $('cSel').textContent = elName(k);
  $('eSize').value = c.s; $('vSize').textContent = c.s + '%';
  $('eOp').value = c.op; $('vOp').textContent = c.op + '%';
  const sh = $('eShape');
  sh.innerHTML = '';
  for (const [v, lab] of shapeSetFor(k)) {
    const b = document.createElement('button');
    b.setAttribute('data-v', v); b.textContent = lab;
    sh.appendChild(b);
  }
  segSet('eShape', c.shape || base.shape);
  // Підпис є лише в кнопок дій — у стрілок його роль грає сама форма.
  $('rLab').hidden = !base.cap;
  segSet('eLab', String(c.lab));
  segSet('eVib', String(c.vib));
  segSet('eHide', String(c.hide));
  posLabel(k);
  syncControls();
}
/* Панель параметрів ніколи не має накривати кнопку, яку налаштовують:
   міняти розмір наосліп — марна справа. Тому вона стає на ту половину
   екрана, де більше вільного місця, і рівно на це місце обмежується
   висотою. Якщо місця мало — всередині панелі просто з'явиться
   прокрутка, а кнопка лишиться на очах. */
function placePanel(panel, k) {
  const g = Input.geo[k];
  const head = document.querySelector('#controls .shead');
  const headB = head ? head.getBoundingClientRect().bottom : 88;
  const H = window.innerHeight;
  panel.style.setProperty('--headH', Math.round(headB) + 'px');
  if (!g) { panel.classList.remove('top'); panel.style.maxHeight = ''; return; }
  const GAP = 10;
  const spaceTop = (g.y - g.h / 2) - headB - GAP;
  const spaceBottom = H - (g.y + g.h / 2) - GAP;
  const top = spaceTop > spaceBottom;
  panel.classList.toggle('top', top);
  panel.style.maxHeight = Math.max(96, Math.round(top ? spaceTop : spaceBottom)) + 'px';
}

function posLabel(k) {
  const c = Pad.el(k);
  $('ePos').textContent = (c.x === null && c.y === null)
    ? 'штатна' : Math.round(c.x * 100) + '% × ' + Math.round(c.y * 100) + '%';
}
function onDragged(k) { if (k && k !== selEl) selectElem(k); else if (k) posLabel(k); syncControls(); }

export function syncControls() {
  // Профілі — вкладками в шапці: перемикання одним тапом.
  const t = $('cProf');
  if (t.children.length !== 3) {
    t.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.setAttribute('data-v', String(i));
      t.appendChild(b);
    }
  }
  for (let i = 0; i < 3; i++) {
    const b = t.children[i];
    b.textContent = Pad.state.profs[i].name;
    b.classList.toggle('on', i === Pad.state.prof);
  }
  // Червоні контури й банер перекриття малює Input.layout() — тут лише
  // те, що належить панелі.
  if (selEl) posLabel(selEl);
}

function initControlsScreen() {
  $('cDone').addEventListener('click', () => {
    Sfx.ui();
    // Зберегти криву розкладку можна — але усвідомлено.
    if (Input.bad().size && !confirmOverlap()) return;
    testing = false; Input.setTest(false); $('cTest').textContent = 'Перевірити';
    selectElem(null); Pad.save(); showScreen('settings');
  });
  $('cClose').addEventListener('click', () => { Sfx.ui(); selectElem(null); });
  $('cTest').addEventListener('click', () => {
    Sfx.ui(); testing = !testing; Input.setTest(testing);
    $('cTest').textContent = testing ? 'Готово' : 'Перевірити';
    $('cHint').textContent = testing
      ? 'Тестова зона: тисни кнопки — вони блимають і вібрують, у гру нічого не йде.'
      : 'Торкнись кнопки, щоб налаштувати її. Перетягни — щоб перенести.';
    if (testing) selectElem(null);
  });
  $('cElReset').addEventListener('click', () => {
    if (!selEl) return;
    Sfx.ui(); Pad.resetElem(selEl); Input.layout(); selectElem(selEl);
  });
  const slide = (id, lab, field, lo, hi) => $(id).addEventListener('input', e => {
    if (!selEl) return;
    const v = clampInt(e.target.value, lo, hi);
    Pad.el(selEl)[field] = v;
    $(lab).textContent = v + '%';
    Input.layout(); Pad.save(); syncControls();
  });
  slide('eSize', 'vSize', 's', 60, 200);
  slide('eOp', 'vOp', 'op', 20, 100);
  const seg = (id, fn) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !selEl) return;
    Sfx.ui(); fn(b.getAttribute('data-v'));
    Input.layout(); Pad.save(); selectElem(selEl);
  });
  seg('eShape', v => { Pad.el(selEl).shape = v; });
  seg('eLab', v => { Pad.el(selEl).lab = +v; });
  seg('eVib', v => { Pad.el(selEl).vib = +v; if (+v) buzz(18); });
  seg('eHide', v => { Pad.el(selEl).hide = +v; });

  $('cProf').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    Sfx.ui(); Input.profile(+b.getAttribute('data-v'));
    selectElem(null); syncControls();
  });
  $('ePreset').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    Sfx.ui(); Input.preset(b.getAttribute('data-v'));
    selectElem(null); syncControls(); syncSettings();
  });
  $('eCopy').addEventListener('click', () => {
    Sfx.ui();
    const str = Pad.exportStr();
    $('eStr').value = str;
    $('eStr').select();
    try { navigator.clipboard && navigator.clipboard.writeText(str); } catch (e) { }
    flash('eCopy', 'Скопійовано');
  });
  $('ePaste').addEventListener('click', () => {
    Sfx.ui();
    const ok = Pad.importStr($('eStr').value);
    Input.layout(); selectElem(null); syncControls();
    flash('ePaste', ok ? 'Готово' : 'Не той рядок');
  });
  $('eResetAll').addEventListener('click', () => {
    Sfx.ui(); Pad.resetProfile(); Input.layout(); selectElem(null); syncControls();
  });
}
function flash(id, txt) {
  const b = $(id), old = b.textContent;
  b.textContent = txt;
  setTimeout(() => { b.textContent = old; }, 1100);
}
/** Друге натискання «Назад» підтверджує збереження кривої розкладки. */
let overlapAsked = 0;
function confirmOverlap() {
  if (overlapAsked) { overlapAsked = 0; return true; }
  overlapAsked = 1;
  $('cWarn').textContent = 'Кнопки перекриваються. Натисни «Назад» ще раз, щоб усе одно зберегти.';
  setTimeout(() => {
    overlapAsked = 0;
    $('cWarn').textContent = 'Кнопки перекриваються — одна з них не натиснеться';
  }, 3000);
  return false;
}
function clampInt(v, lo, hi) { v = parseInt(v, 10); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }

/* ======================================================= ЕКРАН АРСЕНАЛУ
   Дві комірки: ближня і дальня. Міняти можна на чекпоінті, у паузі,
   перед боєм із босом — або будь-коли, якщо ввімкнено «вільну зміну». */
let invTab = 'melee';
let invPick = null;
let invBack = 'menu';
const icon = id => 'assets/wpn/' + id + '.png';

function drawSlot(el, id, sel) {
  const w = WEAPONS[id];
  el.classList.toggle('sel', sel);
  el.querySelector('img').src = icon(id);
  el.querySelector('b').textContent = w ? w.name : '—';
}
function buildInv() {
  const ids = invTab === 'melee' ? MELEE_IDS : RANGED_IDS;
  const cur = invTab === 'melee' ? Store.data.melee : Store.data.ranged;
  if (!invPick || WEAPONS[invPick].kind !== invTab) invPick = cur;
  const g = $('iGrid');
  g.innerHTML = '';
  for (const id of ids) {
    const own = Store.data.owned.indexOf(id) >= 0;
    const b = document.createElement('button');
    b.className = 'wit' + (id === cur ? ' on' : '') + (own ? '' : ' lock');
    b.innerHTML = '<img alt="' + WEAPONS[id].name + '">';
    b.querySelector('img').src = icon(id);
    b.addEventListener('click', () => { Sfx.ui(); invPick = id; if (own) equip(id); else buildInv(); });
    g.appendChild(b);
  }
  drawSlot($('slotMelee'), Store.data.melee, invTab === 'melee');
  drawSlot($('slotRanged'), Store.data.ranged, invTab === 'ranged');
  segSet('iTabs', invTab);
  segSet('iFree', String(Store.data.freeSwap));

  const w = WEAPONS[invPick];
  const own = Store.data.owned.indexOf(invPick) >= 0;
  const bar = (lab, v) => '<div class="bar">' + lab + '<i><b style="width:' + (v * 20) + '%"></b></i></div>';
  $('iCard').innerHTML =
    '<h3>' + (own ? w.name : '???') + '</h3>' +
    '<p>' + (own ? w.desc : 'Ще не знайдена. ' + unlockText(w) + '.') + '</p>' +
    (own ? '<div class="bars">' + bar('Шкода', w.bars.dmg) + bar('Темп', w.bars.spd) +
           bar('Дистанція', w.bars.rng) + '</div>' +
           '<div class="mini" style="text-align:left;margin-top:5px">РЕСУРС: ' + w.res.toUpperCase() + '</div>' : '');
  const can = canSwapNow();
  $('iHint').textContent = can
    ? 'Зміна доступна. Комірки застосуються одразу.'
    : 'Зброю міняють на чекпоінті, у паузі або перед ареною боса.';
}
function equip(id) {
  if (!canSwapNow()) { buildInv(); return; }
  const w = WEAPONS[id];
  if (w.kind === 'melee') Store.data.melee = id; else Store.data.ranged = id;
  Store.save(); refreshEquip(); buzz(14); buildInv();
}
export function openInv(back) {
  invBack = back || 'settings';
  invTab = 'melee'; invPick = Store.data.melee;
  buildInv(); showScreen('inv');
}
function initInvScreen() {
  segBind('iTabs', v => { invTab = v; invPick = null; }, buildInv);
  segBind('iFree', v => { Store.data.freeSwap = +v; }, buildInv);
  $('slotMelee').addEventListener('click', () => { Sfx.ui(); invTab = 'melee'; invPick = null; buildInv(); });
  $('slotRanged').addEventListener('click', () => { Sfx.ui(); invTab = 'ranged'; invPick = null; buildInv(); });
  $('iDone').addEventListener('click', () => { Sfx.ui(); showScreen(invBack); });
}

export function initUI() {
  hooks.showScreen = showScreen;
  hooks.refreshLevels = buildLevelGrid;
  hooks.refreshProgress = updateProgressLabel;
  hooks.setClear = (title, sub) => { $('clTitle').textContent = title; $('clSub').textContent = sub; };
  hooks.setWinStat = s => { $('winStat').textContent = s; };
  hooks.showReward = showReward;
  hooks.askAssist = name => { $('asName').textContent = name; showScreen('assist'); };

  $('mPlay').addEventListener('click', () => {
    Sfx.ui();
    // Перший запуск: питаємо про навчання РІВНО ОДИН РАЗ. Далі воно
    // живе окремим пунктом у налаштуваннях і нікому не заважає.
    if (!Store.data.tutAsked && Store.data.unlocked === 1) {
      Store.data.tutAsked = 1; Store.save();
      showScreen('tutask');
      return;
    }
    Game.startLevel(Math.max(0, Math.min(LEVELS.length - 1, Store.data.unlocked - 1)), false);
  });
  $('tuYes').addEventListener('click', () => { Sfx.ui(); Game.startTutorial(); });
  $('tuNo').addEventListener('click', () => { Sfx.ui(); Game.startLevel(0, false); });
  $('mLevels').addEventListener('click', () => { Sfx.ui(); buildLevelGrid(); showScreen('levels'); });
  $('mSet').addEventListener('click', () => { Sfx.ui(); Game.backTo = 'menu'; syncSettings(); showScreen('settings'); });
  $('mAbout').addEventListener('click', () => { Sfx.ui(); showScreen('about'); });
  $('mNG').addEventListener('click', () => {
    Sfx.ui();
    Store.data.ng = 1; Store.data.unlocked = LEVELS.length; Store.save();
    buildLevelGrid(); updateProgressLabel();
    Game.startLevel(0, false);
  });
  for (const b of document.querySelectorAll('[data-back]'))
    b.addEventListener('click', () => {
      Sfx.ui();
      const t = b.getAttribute('data-back');
      showScreen(t === 'menu' ? Game.backTo : t);
    });
  $('pRes').addEventListener('click', () => { Sfx.ui(); Game.resume(); });
  $('pRestart').addEventListener('click', () => { Sfx.ui(); Game.startLevel(Game.level, false); });
  $('pSet').addEventListener('click', () => { Sfx.ui(); Game.backTo = 'pause'; syncSettings(); showScreen('settings'); });
  $('pMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });
  $('asYes').addEventListener('click', () => { Sfx.ui(); Game.setAssist(true); });
  $('asNo').addEventListener('click', () => { Sfx.ui(); Game.setAssist(false); });
  $('dRetry').addEventListener('click', () => { Sfx.ui(); Game.startLevel(Game.level, true); });
  $('dMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });
  $('clNext').addEventListener('click', () => { Sfx.ui(); Game.startLevel(Game.level + 1, false); });
  $('clMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });
  $('wMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });

  $('sVol').addEventListener('input', e => {
    Store.data.vol = +e.target.value || 0; $('vVol').textContent = Store.data.vol + '%';
    applyVolume(); Store.save(); Sfx.ui();
  });
  $('sMus').addEventListener('input', e => {
    Store.data.mus = +e.target.value || 0; $('vMus').textContent = Store.data.mus + '%';
    applyVolume(); Store.save();
  });
  segBind('sGfx', v => { Store.data.gfx = v; Gfx.applyQuality(); });
  segBind('sCam', v => { Store.data.cam = +v; });
  segBind('sDim', v => { Store.data.dimFight = +v; });
  segBind('sCrt', v => { Store.data.crt = +v; Gfx.applyQuality(); });
  segBind('sOut', v => { Store.data.outline = +v; Gfx.applyQuality(); });
  segBind('sDbg', v => { Store.data.dbg = +v; });
  segBind('cVib', v => { Store.data.vib = +v; buzz(v === '2' ? 40 : 18); });
  segBind('cHand', v => { Pad.hand = +v; Pad.save(); Input.layout(); });
  segBind('sProf', v => { Input.profile(+v); });
  segBind('sDiff', v => { setDifficulty(v); });
  // Вкладки налаштувань. Позиція прокрутки в кожній своя.
  $('sTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    Sfx.ui(); setTab(b.getAttribute('data-v'));
  });
  $('sBody').addEventListener('scroll', fadeSync, { passive: true });
  window.addEventListener('resize', () => { if (curScreen === 'settings') fadeSync(); });
  $('sTut').addEventListener('click', () => { Sfx.ui(); Game.startTutorial(); });
  $('sRange').addEventListener('click', () => { Sfx.ui(); Game.startRange(Game.backTo); });
  $('pRange').addEventListener('click', () => { Sfx.ui(); Game.startRange('pause'); });
  for (const [id, lab, key] of [['sBloom', 'vBloom', 'bloom'], ['sAb', 'vAb', 'ab'], ['sBg', 'vBg', 'bgDim']])
    $(id).addEventListener('input', e => {
      Store.data[key] = +e.target.value || 0;
      $(lab).textContent = Store.data[key] + '%';
      Gfx.applyQuality(); Store.save();
    });
  $('sClean').addEventListener('click', () => {
    Sfx.ui(); Gfx.cleanMode(); Store.save(); syncSettings();
    $('sClean').textContent = 'Чистий режим увімкнено';
    setTimeout(() => { $('sClean').textContent = 'Чистий режим — без пост-ефектів'; }, 1200);
  });
  $('sCtrl').addEventListener('click', () => {
    Sfx.ui(); selectElem(null); syncControls(); showScreen('controls');
  });
  $('sInv').addEventListener('click', () => { Sfx.ui(); openInv('settings'); });
  $('pInv').addEventListener('click', () => { Sfx.ui(); openInv('pause'); });
  initControlsScreen();
  initInvScreen();
  initRangeScreen();
  initTutorialBar();
  hooks.tutStep = tutShow;
  hooks.tutSkip = () => { $('tbSkip').hidden = false; };
  hooks.tutDone = () => { tutShow(null); showScreen('tutdone'); };
  hooks.tutQuit = () => { tutShow(null); Game.toMenu(); };
  $('sReset').addEventListener('click', () => {
    Sfx.ui(); Store.clear(); buildLevelGrid(); updateProgressLabel();
    $('sReset').textContent = 'Прогрес скинуто';
    setTimeout(() => { $('sReset').textContent = 'Скинути прогрес'; }, 1200);
  });
  buildLevelGrid();
  updateProgressLabel();
  setTab('ctl');
  syncSettings();
  syncControls();
}

/* ================================================ ТРЕНУВАЛЬНА КІМНАТА
   Панель — окремий екран поверх гри. Усе, що вона міняє, діє одразу й
   не пишеться в збереження: кімната не має слідів. */
const SEG = (id, items, cur, fn) => {
  const box = $(id);
  if (box.children.length !== items.length) {
    box.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.setAttribute('data-v', it.v); b.textContent = it.n;
      box.appendChild(b);
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      Sfx.ui(); fn(b.getAttribute('data-v')); syncRange();
    });
  }
  segSet(id, String(cur));
};

export function syncRange() {
  const S = Game.rangeInfo();
  SEG('rgMelee', MELEE_IDS.map(id => ({ v: id, n: WEAPONS[id].name.split(' ')[0] })),
      Store.data.melee, v => { Store.data.melee = v; refreshEquip(); });
  SEG('rgRanged', RANGED_IDS.map(id => ({ v: id, n: WEAPONS[id].name.split(' ')[0] })),
      Store.data.ranged, v => { Store.data.ranged = v; refreshEquip(); });
  SEG('rgParry', S.speeds.map((p, i) => ({ v: i, n: p.name })), S.parrySpeed,
      v => Game.rangeSetParry(+v));
  SEG('rgBoss', [{ v: '', n: 'Нікого' }].concat(S.bosses.map(b => ({ v: b.id, n: b.name.split('-')[0] }))),
      S.boss || '', v => Game.rangeCallBoss(v || null, S.bossPhase));
  segSet('rgGod', String(S.god));
  segSet('rgBox', String(Store.data.dbg));
  segSet('rgPhase', String(S.bossPhase));
}

function initRangeScreen() {
  $('rgPanel').addEventListener('click', () => { Sfx.ui(); syncRange(); showScreen('rangeSet'); });
  $('rgClose').addEventListener('click', () => { Sfx.ui(); showScreen(null); Game.resumeRange(); });
  $('rgExit').addEventListener('click', () => { Sfx.ui(); Game.leaveRange(); });
  $('rgLeave').addEventListener('click', () => { Sfx.ui(); Game.leaveRange(); });
  $('rgReset').addEventListener('click', () => { Sfx.ui(); Game.rangeReset(); syncRange(); });
  segBind('rgGod', v => { Game.rangeSetGod(+v); }, syncRange);
  segBind('rgBox', v => { Store.data.dbg = +v; }, syncRange);
  segBind('rgPhase', v => { Game.rangeSetPhase(+v); }, syncRange);
}

/** Складність міняється будь-коли й нічого не блокує. */
function setDifficulty(v) {
  Store.data.diff = (v === 'easy' || v === 'hard') ? v : 'normal';
  Store.save();
  Game.applyDifficulty();
  syncSettings();
}
