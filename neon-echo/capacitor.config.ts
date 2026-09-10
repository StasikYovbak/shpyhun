import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neonecho.game',
  appName: 'Neon Echo',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b0413',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  },
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0b0413',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: { overlaysWebView: true, style: 'DARK' }
  }
};
export default config;
