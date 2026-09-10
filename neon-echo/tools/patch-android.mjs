/**
 * Патчі нативного проєкту після `npx cap sync android`.
 * Ідемпотентні — можна ганяти скільки завгодно разів (і локально, і в CI).
 * Роблять рівно те, через що гра в браузері здавалася маленькою:
 * повний екран, immersive sticky, орієнтація, виріз камери, вібрація.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = p => path.join(root, 'android', p);
const log = [];
function edit(file, fn) {
  if (!fs.existsSync(file)) { log.push('— немає ' + path.relative(root, file)); return; }
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) { fs.writeFileSync(file, after); log.push('✎ ' + path.relative(root, file)); }
  else log.push('= ' + path.relative(root, file) + ' (вже пропатчено)');
}

/* 1. AndroidManifest: дозволи, орієнтація, тема, зміни конфігурації */
edit(A('app/src/main/AndroidManifest.xml'), s => {
  if (!s.includes('android.permission.VIBRATE'))
    s = s.replace('<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n'
      + '    <uses-permission android:name="android.permission.VIBRATE" />\n'
      + '    <uses-permission android:name="android.permission.WAKE_LOCK" />');
  if (!s.includes('android:screenOrientation'))
    s = s.replace('android:name=".MainActivity"',
      'android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"');
  s = s.replace(/android:configChanges="[^"]*"/,
    'android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density|layoutDirection"');
  if (!s.includes('android:resizeableActivity'))
    s = s.replace('android:launchMode="singleTask"',
      'android:launchMode="singleTask"\n            android:resizeableActivity="false"');
  return s;
});

/* 2. Тема: повний екран + виріз камери shortEdges */
edit(A('app/src/main/res/values/styles.xml'), s => {
  if (!s.includes('android:windowFullscreen')) {
    s = s.replace('<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">\n'
      + '        <item name="windowActionBar">false</item>\n'
      + '        <item name="windowNoTitle">true</item>\n'
      + '        <item name="android:background">@null</item>\n'
      + '    </style>',
      '<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">\n'
      + '        <item name="windowActionBar">false</item>\n'
      + '        <item name="windowNoTitle">true</item>\n'
      + '        <item name="android:background">@null</item>\n'
      + '        <item name="android:windowFullscreen">true</item>\n'
      + '        <item name="android:windowTranslucentStatus">true</item>\n'
      + '        <item name="android:windowTranslucentNavigation">true</item>\n'
      + '        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>\n'
      + '        <item name="android:statusBarColor">@android:color/transparent</item>\n'
      + '        <item name="android:navigationBarColor">@android:color/transparent</item>\n'
      + '    </style>');
  }
  if (!s.includes('NoActionBarLaunch') || !s.includes('windowLayoutInDisplayCutoutMode">shortEdges</item>\n        <item name="android:background">@drawable/splash'))
    s = s.replace('<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n'
      + '        <item name="android:background">@drawable/splash</item>\n    </style>',
      '<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n'
      + '        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>\n'
      + '        <item name="android:background">@drawable/splash</item>\n    </style>');
  return s;
});

/* 3. MainActivity: immersive sticky + екран не гасне + повернення прапорців */
const mainJava = A('app/src/main/java/com/neonecho/game/MainActivity.java');
edit(mainJava, s => {
  if (s.includes('IMMERSIVE_STICKY')) return s;
  return `package com.neonecho.game;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * Повний екран без системних панелей.
 * Прапорці треба перевстановлювати в onWindowFocusChanged — інакше
 * навігаційна панель повертається після згортання застосунку.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        hideSystemUi();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    private void hideSystemUi() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
}
`;
});

/* 4. Іконки й splash — кладемо згенеровані */
const res = A('app/src/main/res');
const gen = path.join(root, 'build-res');
if (fs.existsSync(gen)) {
  for (const [dpi] of Object.entries({ mdpi: 1, hdpi: 1, xhdpi: 1, xxhdpi: 1, xxxhdpi: 1 })) {
    const src = path.join(gen, `ic_launcher_${dpi}.png`);
    const dir = path.join(res, `mipmap-${dpi}`);
    if (fs.existsSync(src) && fs.existsSync(dir)) {
      for (const n of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'])
        fs.copyFileSync(src, path.join(dir, n));
    }
  }
  const sp = path.join(gen, 'splash.png');
  for (const d of fs.readdirSync(res)) {
    if (d.startsWith('drawable') && fs.existsSync(sp)) {
      const t = path.join(res, d, 'splash.png');
      if (fs.existsSync(t)) fs.copyFileSync(sp, t);
    }
  }
  const dr = path.join(res, 'drawable');
  if (fs.existsSync(dr) && fs.existsSync(sp)) fs.copyFileSync(sp, path.join(dr, 'splash.png'));
  log.push('✎ іконки та splash оновлено');
}

/* 5. Колір фону вікна */
edit(A('app/src/main/res/values/colors.xml'), s =>
  s.includes('#0b0413') ? s : s.replace('</resources>',
    '    <color name="neonBg">#0b0413</color>\n</resources>'));

console.log(log.join('\n'));
