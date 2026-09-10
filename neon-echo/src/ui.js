/** Екрани меню (DOM поверх канви) і прив'язка налаштувань. */
import { Store } from './store.js';
import { Sfx, applyVolume } from './audio.js';
import { Input } from './input.js';
import { Game, hooks, LEVELS } from './core.js';
import { Gfx } from './render/index.js';

const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'levels', 'settings', 'about', 'pause', 'dead', 'clear', 'win'];
export let curScreen = 'menu';

export function showScreen(id) {
  curScreen = id;
  for (const s of SCREENS) $(s).classList.toggle('on', s === id);
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
function segBind(id, fn) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    Sfx.ui(); fn(b.getAttribute('data-v')); Store.save(); syncSettings();
  });
}
function segSet(id, val) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.getAttribute('data-v') === val);
}
export function syncSettings() {
  $('sVol').value = Store.data.vol;
  $('sMus').value = Store.data.mus;
  $('sOp').value = Store.data.op;
  segSet('sVib', String(Store.data.vib));
  segSet('sSize', Store.data.size);
  segSet('sHand', String(Store.data.hand));
  segSet('sGfx', Store.data.gfx);
  segSet('sCrt', String(Store.data.crt));
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
  $('sOp').addEventListener('input', e => {
    Store.data.op = Math.max(30, Math.min(90, +e.target.value || 55)); Input.layout(); Store.save();
  });
  segBind('sVib', v => { Store.data.vib = +v; });
  segBind('sSize', v => { Store.data.size = v; Input.layout(); });
  segBind('sHand', v => { Store.data.hand = +v; Input.layout(); });
  segBind('sGfx', v => { Store.data.gfx = v; Gfx.applyQuality(); });
  segBind('sCrt', v => { Store.data.crt = +v; Gfx.applyQuality(); });
  $('sReset').addEventListener('click', () => {
    Sfx.ui(); Store.clear(); buildLevelGrid(); updateProgressLabel();
    $('sReset').textContent = 'Прогрес скинуто';
    setTimeout(() => { $('sReset').textContent = 'Скинути прогрес'; }, 1200);
  });
  buildLevelGrid();
  updateProgressLabel();
  syncSettings();
}
