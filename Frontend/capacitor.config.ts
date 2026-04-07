import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sf.stock.app',
  appName: 'SF Srikakulam',
  webDir: 'dist',
  server: {
    url: 'https://sahilsync07.github.io/sf/',
    cleartext: false
  }
};

export default config;
