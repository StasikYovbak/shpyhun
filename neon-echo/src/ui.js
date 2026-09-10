/** Екрани меню (DOM поверх канви) і прив'язка налаштувань. */
import { Store } from './store.js';
import { Sfx, applyVolume, buzz } from './audio.js';
import { Input } from './input.js';
import { Game, hooks, LEVELS, canSwapNow, refreshEquip } from './core.js';
import { WEAPONS, MELEE_IDS, RANGED_IDS, unlockText } from './weapons.js';
import { Gfx } from './render/index.js';

const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'levels', 'settings', 'controls', 'inv', 'about', 'pause', 'dead', 'clear', 'win'];
export let curScreen = 'menu';

export function showScreen(id) {
  curScreen = id;
  for (const s of SCREENS) $(s).classList.toggle('on', s === id);
  Input.setPreview(id === 'controls', syncControls);   // живий перегляд керування
  Input.enable(id === null || id === undefined);
}
function updateProgressLabel() {
  $('mProg').textContent = 'ВІДКРИТО СЕКТОРІВ: ' + Store.data.unlocked + ' / ' + LEVELS.length;
  $('mPlay').textContent = Store.data.unlocked > 1 ? 'Продовжити' : 'Грати';
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
export function syncSettings() {
  $('sVol').value = Store.data.vol;
  $('sMus').value = Store.data.mus;
  segSet('sGfx', Store.data.gfx);
  segSet('sCrt', String(Store.data.crt));
}


/* ==================================================== ЕКРАН КЕРУВАННЯ
   Живий перегляд: шар #touch у режимі .prev лежить поверх панелі, тож
   кожен рух повзунка видно одразу на самій хрестовині й кнопках. */
const CTL = [
  ['cDpadOp', 'vDpadOp', 'dpadOp', 20, 100, '%'],
  ['cDpadSize', 'vDpadSize', 'dpadSize', 70, 160, '%'],
  ['cBtnOp', 'vBtnOp', 'btnOp', 20, 100, '%'],
  ['cBtnSize', 'vBtnSize', 'btnSize', 70, 160, '%']
];
function presetOf() {
  const d = Store.data;
  for (const [name, p] of Object.entries(Input.presets)) {
    if (d.dpadSize === p.dpadSize && d.btnSize === p.btnSize &&
        d.dpadOp === p.dpadOp && d.btnOp === p.btnOp &&
        !d.dpadPos && !d.btnPos && d.hand === (p.hand || 0)) return name;
  }
  return '';
}
export function syncControls() {
  for (const [sl, lab, key, lo, hi, suf] of CTL) {
    const v = clampInt(Store.data[key], lo, hi);
    $(sl).value = v; $(lab).textContent = v + suf;
  }
  segSet('cHand', String(Store.data.hand));
  segSet('cVib', String(Store.data.vib));
  segSet('cPreset', presetOf());
  const moved = Store.data.dpadPos || Store.data.btnPos;
  $('cHint').textContent = moved
    ? 'Блоки стоять там, куди ти їх переніс. «Скинути позиції» поверне їх у кути.'
    : 'Перетягни блоки пальцем — вони лишаються на місці.';
}
function clampInt(v, lo, hi) { v = parseInt(v, 10); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }

function initControlsScreen() {
  for (const [sl, lab, key, lo, hi, suf] of CTL) {
    $(sl).addEventListener('input', e => {
      Store.data[key] = clampInt(e.target.value, lo, hi);
      if (key === 'btnOp') Store.data.op = Store.data.btnOp;   // сумісність зі старим ключем
      $(lab).textContent = Store.data[key] + suf;
      Input.layout(); Store.save(); segSet('cPreset', presetOf());
    });
  }
  segBind('cHand', v => { Store.data.hand = +v; Input.layout(); }, syncControls);
  segBind('cVib', v => { Store.data.vib = +v; buzz(v === '2' ? 40 : 18); }, syncControls);
  segBind('cPreset', v => { Input.preset(v); }, syncControls);
  $('cResetPos').addEventListener('click', () => {
    Sfx.ui(); Store.data.dpadPos = null; Store.data.btnPos = null;
    Input.layout(); Store.save(); syncControls();
  });
  $('cResetAll').addEventListener('click', () => {
    Sfx.ui(); Input.preset('default'); Store.data.vib = 1; Store.save(); syncControls();
  });
  $('cDone').addEventListener('click', () => { Sfx.ui(); showScreen('settings'); });
}

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

  $('mPlay').addEventListener('click', () => {
    Sfx.ui(); Game.startLevel(Math.max(0, Math.min(LEVELS.length - 1, Store.data.unlocked - 1)), false);
  });
  $('mLevels').addEventListener('click', () => { Sfx.ui(); buildLevelGrid(); showScreen('levels'); });
  $('mSet').addEventListener('click', () => { Sfx.ui(); Game.backTo = 'menu'; syncSettings(); showScreen('settings'); });
  $('mAbout').addEventListener('click', () => { Sfx.ui(); showScreen('about'); });
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
  $('dRetry').addEventListener('click', () => { Sfx.ui(); Game.startLevel(Game.level, true); });
  $('dMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });
  $('clNext').addEventListener('click', () => { Sfx.ui(); Game.startLevel(Game.level + 1, false); });
  $('clMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });
  $('wMenu').addEventListener('click', () => { Sfx.ui(); Game.toMenu(); });

  $('sVol').addEventListener('input', e => { Store.data.vol = +e.target.value || 0; applyVolume(); Store.save(); });
  $('sMus').addEventListener('input', e => { Store.data.mus = +e.target.value || 0; applyVolume(); Store.save(); });
  segBind('sGfx', v => { Store.data.gfx = v; Gfx.applyQuality(); });
  segBind('sCrt', v => { Store.data.crt = +v; Gfx.applyQuality(); });
  $('sCtrl').addEventListener('click', () => { Sfx.ui(); syncControls(); showScreen('controls'); });
  $('sInv').addEventListener('click', () => { Sfx.ui(); openInv('settings'); });
  $('pInv').addEventListener('click', () => { Sfx.ui(); openInv('pause'); });
  initControlsScreen();
  initInvScreen();
  $('sReset').addEventListener('click', () => {
    Sfx.ui(); Store.clear(); buildLevelGrid(); updateProgressLabel();
    $('sReset').textContent = 'Прогрес скинуто';
    setTimeout(() => { $('sReset').textContent = 'Скинути прогрес'; }, 1200);
  });
  buildLevelGrid();
  updateProgressLabel();
  syncSettings();
  syncControls();
}
