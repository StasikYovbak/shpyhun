/** Палітри локацій. Використовуються і грою (фон, світло), і генератором тайлів. */
export const THEME = {
  slum:    { sky: ['#1b0a2a', '#3a1148'], far: '#2a1140', mid: '#3d1a58', tile: '#4a2a6b',
             edge: '#ff2e88', glow: '#22e0ff', fx: 'rain',   grade: [0.10, 0.02, 0.18] },
  docks:   { sky: ['#0d1a2a', '#1d3350'], far: '#16283f', mid: '#1f3c5c', tile: '#2b4a6e',
             edge: '#22e0ff', glow: '#ffd23f', fx: 'rain',   grade: [0.02, 0.08, 0.20] },
  roofs:   { sky: ['#160b2e', '#4b1a55'], far: '#241046', mid: '#372060', tile: '#40296f',
             edge: '#ffd23f', glow: '#ff2e88', fx: 'rain',   grade: [0.12, 0.03, 0.20] },
  factory: { sky: ['#26120a', '#48210f'], far: '#331a10', mid: '#48281a', tile: '#5a3320',
             edge: '#ffa23f', glow: '#ff6b3d', fx: 'spark',  grade: [0.20, 0.08, 0.02] },
  metro:   { sky: ['#07070f', '#12101f'], far: '#0e0d1a', mid: '#171528', tile: '#241f38',
             edge: '#3d8f6f', glow: '#3dff9a', fx: 'dust',   grade: [0.02, 0.10, 0.06] },
  garden:  { sky: ['#2a0f2c', '#5a2246'], far: '#3d1636', mid: '#552048', tile: '#5e2a52',
             edge: '#ffb7d5', glow: '#ff8fc0', fx: 'petal',  grade: [0.18, 0.06, 0.14] },
  server:  { sky: ['#0b1a1c', '#123033'], far: '#0f2427', mid: '#173338', tile: '#1f4348',
             edge: '#3dffe0', glow: '#ffd23f', fx: 'steam',  grade: [0.02, 0.14, 0.14] },
  virtual: { sky: ['#050516', '#101040'], far: '#0a0a28', mid: '#141450', tile: '#1c1c66',
             edge: '#00ffcc', glow: '#ff2e88', fx: 'glitch', grade: [0.04, 0.10, 0.24] },
  spire:   { sky: ['#100a2c', '#2b1c66'], far: '#1a1240', mid: '#251a58', tile: '#302070',
             edge: '#7df9ff', glow: '#ffd23f', fx: 'wind',   grade: [0.08, 0.08, 0.24] },
  core:    { sky: ['#1a0416', '#3d0a2a'], far: '#26081f', mid: '#3a0e2e', tile: '#4d1338',
             edge: '#ff2e88', glow: '#ffd23f', fx: 'ember',  grade: [0.24, 0.03, 0.12] }
};
export const THEME_KEYS = Object.keys(THEME);
