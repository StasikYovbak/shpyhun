/**
 * Проганяє весь набір перевірок: піднімає preview-сервер зі зібраним
 * застосунком, ганяє тести, гасить сервер.
 *   npm test
 */
import { spawn, spawnSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const PORT = 4173;
const url = `http://localhost:${PORT}/`;
let srv = null;

async function waitServer(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { }
    await sleep(300);
  }
  return false;
}
const run = (file) => {
  console.log('\n──────── ' + file + ' ────────');
  const r = spawnSync(process.execPath, ['tests/' + file], {
    stdio: 'inherit', env: { ...process.env, URL: url }
  });
  return r.status === 0;
};

console.log('складання...');
if (spawnSync('npm', ['run', 'build'], { stdio: 'ignore' }).status !== 0) {
  console.error('білд не вдався'); process.exit(1);
}
srv = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore', detached: true });
if (!await waitServer()) { console.error('preview-сервер не піднявся'); process.exit(1); }

let ok = true;
ok = run('gaps.mjs') && ok;
ok = run('reach.mjs') && ok;
ok = run('smoke.mjs') && ok;
ok = run('mechanics.mjs') && ok;
ok = run('pad.mjs') && ok;
ok = run('anim.mjs') && ok;
ok = run('music.mjs') && ok;
ok = run('prism.mjs') && ok;
ok = run('ui.mjs') && ok;
ok = run('bosskill.mjs') && ok;
ok = run('balance.mjs') && ok;
ok = run('weapons.mjs') && ok;
ok = run('wfx.mjs') && ok;
ok = run('boss2.mjs') && ok;
ok = run('glitch.mjs') && ok;
ok = run('melee-audit.mjs') && ok;
ok = run('dps.mjs') && ok;
ok = run('shotgun.mjs') && ok;
ok = run('homing.mjs') && ok;
ok = run('chrono.mjs') && ok;
ok = run('wanim.mjs') && ok;
ok = run('detail.mjs') && ok;
ok = run('levels.mjs') && ok;
ok = run('cut.mjs') && ok;
ok = run('flow.mjs') && ok;
ok = run('perf.mjs') && ok;
try { process.kill(-srv.pid); } catch (e) { }
console.log('\n' + (ok ? '=== УСІ ПЕРЕВІРКИ ПРОЙДЕНО ===' : '=== Є ПРОБЛЕМИ ==='));
process.exit(ok ? 0 : 1);
