/**
 * Доказ, що при DEV_MODE = false режим бога зникає зі збірки повністю.
 *
 * Скрипт сам вимикає прапорець, збирає реліз, шукає в dist/ усі сліди
 * панелі, читів і діагностики, друкує звіт і повертає прапорець назад
 * у те положення, в якому він був.
 *   node tools/check-release.mjs
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cfg = path.join(root, 'src', 'config.js');
const orig = fs.readFileSync(cfg, 'utf8');
const was = /export const DEV_MODE = (\w+);/.exec(orig)[1];

/** Рядки, яких у релізі не має бути ЖОДНОГО. */
const FORBIDDEN = [
  'GOD MODE', 'godFrame', 'btnDbg', 'dbgPanel', 'dbgRow', 'dbgSec',
  // Маркер має бути ОДНОЗНАЧНИМ. Просто «Безсмертя» вже не годиться:
  // у тренувальній кімнаті є свій, цілком легальний перемикач безсмертя,
  // і перевірка ловила б його як слід режиму бога.
  'РЕЖИМ БОГА', 'Безсмертя (чит)', 'ВБИТИ ВСІХ', 'ВБИТИ МИТТЄВО', 'НАСТУПНИЙ КАДР',
  'Політ / noclip', 'Потрійний стрибок', 'СКОПІЮВАТИ', 'РОЗБЛОКУВАТИ',
  'cheating', 'cheatsOff', 'oneShot', 'stepOnce', 'jump3', 'dmgK',
  'echo_neon_courier_v1_dev'   // окремий слот збереження під DEV_MODE
];

function build(flag) {
  fs.writeFileSync(cfg, orig.replace(/export const DEV_MODE = \w+;/,
                                     'export const DEV_MODE = ' + flag + ';'));
  execSync('npm run build', { cwd: root, stdio: 'ignore' });
  const dir = path.join(root, 'dist');
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(js|css|html)$/.test(f)) files.push(p);
    }
  })(dir);
  const text = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  return { text, bytes, files: files.map(f => path.relative(root, f)) };
}

try {
  console.log('РЕЛІЗНА ЗБІРКА: ЧИ ЛИШИВСЯ СЛІД РЕЖИМУ БОГА\n');
  console.log('  збираю з DEV_MODE = true ...');
  const dev = build('true');
  console.log('  збираю з DEV_MODE = false ...');
  const rel = build('false');

  let bad = 0;
  console.log('\n  рядок                    DEV_MODE=true   DEV_MODE=false');
  console.log('  ' + '-'.repeat(58));
  for (const pat of FORBIDDEN) {
    const inDev = dev.text.split(pat).length - 1;
    const inRel = rel.text.split(pat).length - 1;
    if (inRel > 0) bad++;
    console.log('  ' + pat.padEnd(24) + String(inDev).padStart(8) +
                String(inRel).padStart(16) + (inRel > 0 ? '   ✗' : '   ✓'));
  }
  const chunk = rel.files.filter(f => /debug|cheat/i.test(f));
  console.log('\n  окремий чанк debug/cheats у релізі: ' +
              (chunk.length ? '✗ ' + chunk.join(', ') : '✓ немає'));
  console.log('  розмір dist: DEV ' + (dev.bytes / 1024).toFixed(1) + ' КБ  →  РЕЛІЗ ' +
              (rel.bytes / 1024).toFixed(1) + ' КБ  (−' +
              ((dev.bytes - rel.bytes) / 1024).toFixed(1) + ' КБ)');
  console.log('\n' + (bad === 0 && !chunk.length
    ? 'РЕЛІЗ ЧИСТИЙ: у збірці немає жодного сліду режиму бога'
    : 'ЗНАЙДЕНО СЛІДІВ: ' + (bad + chunk.length)));
  process.exitCode = (bad === 0 && !chunk.length) ? 0 : 1;
} finally {
  fs.writeFileSync(cfg, orig);                     // повертаємо прапорець як був
  console.log('\n(DEV_MODE повернуто у стан ' + was + ')');
  execSync('npm run build', { cwd: root, stdio: 'ignore' });
}
