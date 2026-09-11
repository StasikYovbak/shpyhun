/**
 * Точка входу: піднімає PixiJS, підключає нативні можливості Capacitor
 * (повний екран, орієнтація, вібрація, кнопка «Назад») і крутить цикл
 * із фіксованим кроком фізики 1/60 с.
 */
import '@fontsource/handjet/cyrillic-500.css';
import '@fontsource/handjet/latin-500.css';
import './style.css';

import { DT, MAXDT, PH, BL, RG, CONFIG, TS, SCALE, VW, VH } from './config.js';
import { Store } from './store.js';
import { initAudio, resumeAudio, applyVolume, Sfx, Music, setHaptics } from './audio.js';
import { TRACKS } from './music.js';
import { Input } from './input.js';
import { Gfx } from './render/index.js';
import * as G from './core.js';
import { initUI, showScreen, curScreen } from './ui.js';
import { SCRIPTS as CUT_SCRIPTS } from './cutscene.js';

import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';
import { App } from '@capacitor/app';

const canvas = document.getElementById('game');
let last = 0, acc = 0, audioReady = false, lastFight = null;

/* ------------------------------------------------------- нативний шар */
async function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  try { await StatusBar.setOverlaysWebView({ overlay: true }); await StatusBar.hide(); } catch (e) { }
  try { await ScreenOrientation.lock({ orientation: 'landscape' }); } catch (e) { }
  setHaptics(ms => {
    const style = ms > 40 ? ImpactStyle.Heavy : ms > 18 ? ImpactStyle.Medium : ImpactStyle.Light;
    Haptics.impact({ style }).catch(() => { });
  });
  // системна «назад» ставить на паузу, а не виходить із гри
  App.addListener('backButton', () => {
    if (G.Game.state === 'play') { Sfx.ui(); G.Game.pause(); }
    else if (G.Game.state === 'pause') { Sfx.ui(); G.Game.resume(); }
    else if (curScreen !== 'menu') showScreen('menu');
    else App.exitApp();
  });
  App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) { if (G.Game.state === 'play') G.Game.pause(); Music.stop(); }
    else { last = 0; acc = 0; }
  });
  try { await SplashScreen.hide(); } catch (e) { }
}

/* ------------------------------------------------------------- цикл */
function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  const dtMs = now - last;
  last = now;
  Gfx.sampleFps(dtMs);
  let dt = dtMs / 1000;
  if (dt > MAXDT) dt = MAXDT;

  if (Input.consumePause()) {
    if (G.Game.state === 'play') { Sfx.ui(); G.Game.pause(); }
    else if (G.Game.state === 'pause') { Sfx.ui(); G.Game.resume(); }
    else if (curScreen === 'levels' || curScreen === 'about' ||
             (curScreen === 'settings' && G.Game.backTo === 'menu')) showScreen('menu');
    else if (curScreen === 'settings') showScreen(G.Game.backTo);
  }
  if (G.Game.state === 'cut') {                    // катсцена: гра стоїть, час іде
    G.Cut.step(dt);
    acc = 0;
  } else if (G.Game.state === 'play') {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 6) {
      if (G.timing.hitStop > 0) G.timing.sub(DT);
      else G.stepGame(DT);
      acc -= DT; steps++;
    }
    if (acc > DT * 6) acc = 0;
  } else acc = 0;
  // клас бою на шар керування — CSS робить решту
  const fight = G.Game.state === 'play' && G.Game.combat && Store.data.dimFight;
  if (fight !== lastFight) {
    lastFight = fight;
    document.getElementById('touch').classList.toggle('fight', !!fight);
  }
  Gfx.draw();
}

/* -------------------------------------------------------------- старт */
async function boot() {
  Store.load();
  await Gfx.init(canvas);
  initUI();
  G.loadLevel(0);
  G.buildBackground();
  showScreen('menu');
  const relayout = () => { Gfx.layout(canvas); Input.layout(); };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 120));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  relayout();

  // WebAudio дозволено лише після взаємодії
  const unlock = () => {
    if (!audioReady) {
      audioReady = true; initAudio(); applyVolume();
      // Tone.js стартує лише тут: до першого дотику Android глушить контекст
      Music.unlock().then(() => {
        if (G.Game.state === 'menu') { Music.set('menu'); Music.layer(0); Music.start(); }
      });
    }
    resumeAudio();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'])
    document.addEventListener(ev, unlock, { passive: true });

  // Пропуск катсцени — один тап (чи клавіша) будь-де. Ловимо на capture,
  // щоб екрани меню й шар керування не з'їли подію.
  const skipCut = () => { if (G.Game.state === 'cut') { Sfx.ui(); G.Cut.skip(); } };
  for (const ev of ['pointerdown', 'keydown'])
    document.addEventListener(ev, skipCut, { capture: true, passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { acc = 0; last = 0; if (G.Game.state === 'play') G.Game.pause(); Music.stop(); }
    else {
      last = 0; acc = 0;
      // повертаємось — музику піднімаємо плавно за 0,4 с
      if (audioReady && G.Game.state === 'menu') Music.start();
    }
  });
  window.addEventListener('pagehide', () => { if (G.Game.state === 'play') G.Game.pause(); });
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { });
  } catch (e) { }
  await setupNative();
  document.getElementById('boot').remove();
  requestAnimationFrame(frame);

  // службовий доступ для автотестів
  window.__DEV = {
    G, Game: G.Game, P: G.P, world: G.world, BOSS: G.BOSS, Store, kb: Input.kb, S: Input.S,
    btn: Input.btn, pad: Input.pad, Gfx,
    levels: () => G.LEVELS.length,
    god: v => G.setGod(v),
    step: () => G.stepGame(DT),
    render: () => Gfx.draw(),
    // службовий телепорт на арену: катсцени вважаємо переглянутими,
    // інакше бій не почнеться, поки хтось не тапне по екрану
    gotoBoss: () => {
      for (const k in CUT_SCRIPTS) if (CUT_SCRIPTS[k].id) G.Cut.markSeen(CUT_SCRIPTS[k].id);
      if (G.world.bossX) { G.P.x = G.world.bossX + 16; G.P.y = 13 * 16 - G.P.h - 2; G.P.vy = 0; }
    },
    hurtBoss: n => { if (G.BOSS.on) { G.BOSS.hp -= n; if (G.BOSS.hp <= 0) { G.BOSS.hp = 0; G.bossDie(); } else G.bossCheckPhase(); } },
    killParts: () => { for (const p of G.BOSS.parts) p.alive = false; },
    hitboxes: () => G.bossHitBoxes(),
    shoot: G.shoot, spawnEnemy: G.spawnEnemy, BULL: G.BULL, ENEM: G.ENEM, EQ: G.EQ, DRONES: G.DRONES,
    TELE: G.TELE, ZONES: G.ZONES, BEAMS: G.BEAMS, WEAPONS: G.WEAPONS,
    GLITCH: G.GLITCH, glitchDockPos: G.glitchDockPos,
    pickTarget: G.pickTarget, targets: G.targets,
    Music, Tone: null,
    audioState: () => Music.ctxState(),
    transportState: () => Music.transportState(),
    tracks: () => Object.values(TRACKS).map(t => ({ title: t.title, bpm: t.bpm })),
    trackIds: () => Object.keys(TRACKS),
    layerGains: () => Music.gains(),
    busGain: () => Music.busGain(),
    musicMeter: () => Music.meter(),
    levelReward: G.levelReward, maxHearts: G.maxHearts, fragCount: G.fragCount, PICKS: G.PICKS,
    WFX: G.WFX, wfxKinds: () => G.WFX.map(f => f.k), getSlow: G.getSlow, getDesat: G.getDesat,
    Cut: G.Cut, SCRIPTS: CUT_SCRIPTS,
    equip: (m, r) => { if (m) Store.data.melee = m; if (r) Store.data.ranged = r; G.refreshEquip(); },
    solidAtPx: G.solidAtPx, moveX: G.moveX, moveY: G.moveY, tAt: G.tAt, PH, BL, RG, CONFIG, TS, SCALE, VW, VH, damageEnemy: G.damageEnemy,
    levelInfo: i => ({ n: G.LEVELS[i].n, boss: G.LEVELS[i].boss }),
    counts: () => ({ bull: G.BULL.length, enem: G.ENEM.length, part: G.PARTS.length, ring: G.RINGS.length,
                     tele: G.TELE.length, zone: G.ZONES.length, pick: G.PICKS.length, beam: G.BEAMS.length,
                     ghost: G.GHOSTS.length, pend: G.PENDING.length, trail: G.TRAIL.length,
                     weather: G.WEATHER.length }),
    state: () => ({ hp: G.P.hp, x: G.P.x, y: G.P.y, dead: G.P.dead, state: G.Game.state, level: G.Game.level,
                    bossOn: G.BOSS.on, bossDone: G.BOSS.done, bossHp: G.BOSS.hp, bossPhase: G.BOSS.phase,
                    exitOpen: G.world.exitOpen, grav: G.world.grav, fps: Math.round(Gfx.fps),
                    frameW: Gfx.frameW })
  };
}
boot().catch(e => {
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Помилка запуску: ' + e.message;
  console.error(e);
});
