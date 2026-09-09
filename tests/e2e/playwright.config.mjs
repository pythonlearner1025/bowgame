import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'.',
  testMatch:'bow-player.spec.mjs',
  timeout:30_000,
  fullyParallel:false,
  workers:1,
  reporter:'line',
  use:{
    baseURL:'http://127.0.0.1:43173',
    viewport:{width:1280,height:720},
    headless:true,
    launchOptions:{args:['--headless=new','--use-angle=swiftshader','--enable-unsafe-swiftshader']},
  },
  webServer:{
    command:'npm run preview -- --port 43173',
    cwd:new URL('../..',import.meta.url).pathname,
    url:'http://127.0.0.1:43173',
    reuseExistingServer:false,
    timeout:20_000,
  },
});
