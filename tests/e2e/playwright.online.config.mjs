/** Configures serial two-client browser verification for the online room. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'bow-online.spec.mjs',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.BOWGAME_BASE_URL,
    viewport: { width: 1280, height: 720 },
    headless: true,
    launchOptions: {
      args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
});
