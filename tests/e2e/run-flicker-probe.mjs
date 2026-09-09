/** Captures deterministic frame telemetry and contact sheets for flicker regression analysis. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(new URL('../..', import.meta.url).pathname);
const label = process.env.BOWGAME_FLICKER_LABEL ?? 'local';
const evidenceDir = resolve(root, 'evidence');
let worker = null,
  browser = null,
  baseURL = process.env.BOWGAME_BASE_URL;

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const address = server.address(),
    port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((ok) => server.close(ok));

  return port;
}

async function waitForWorker(url, child) {
  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited with ${child.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      console.warn('Flicker probe is still waiting for the local Worker.', error);
    }

    await new Promise((ok) => setTimeout(ok, 200));
  }

  throw new Error('wrangler dev did not become ready');
}

async function stopWorker(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((ok) => child.once('exit', ok)),
    new Promise((ok) => setTimeout(ok, 3000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function launchBrowser() {
  const attempts = [
    {
      name: 'metal',
      args: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
    {
      name: 'swiftshader',
      args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  ];
  const failures = [];

  for (const attempt of attempts) {
    try {
      const instance = await chromium.launch({ headless: true, args: attempt.args });
      const page = await instance.newPage();
      await page.goto('about:blank');
      await page.close();

      return { instance, backendAttempt: attempt.name, launchArgs: attempt.args, failures };
    } catch (error) {
      failures.push({
        attempt: attempt.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(`Chromium launch failed: ${JSON.stringify(failures)}`);
}

async function enter(page, path, name) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.playerReady === 'true', {
    timeout: 30_000,
  });
  if (path.includes('online=1')) {
    await page.waitForFunction(
      () => window.__KITE_BOW_GAME__?.getState()?.network?.status === 'connected',
      { timeout: 30_000 },
    );
  }
  await page.evaluate((value) => {
    const canvas = document.querySelector('#bow-canvas');
    canvas.requestPointerLock = () => Promise.reject(new Error('probe disables pointer lock'));
    if (value && window.__KITE_BOW_SESSION__) {
      window.__KITE_BOW_SESSION__.setName(value);
    }
    window.__KITE_BOW_GAME__.runtime.enter();
  }, name);
  await page.waitForTimeout(1000);

  return errors;
}

async function capture(page, scenario) {
  return page.evaluate(async (scenarioName) => {
    const viewer = window.viewer,
      canvas = viewer.canvas,
      hud = document.querySelector('#kite3d-bow-game-hud');
    const width = 320,
      height = 180,
      copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('2D capture context unavailable');
    }
    let domMutations = 0,
      preRenders = 0,
      postRenders = 0,
      resizes = 0;
    const observer = new MutationObserver((records) => {
      domMutations += records.length;
    });
    if (hud) {
      observer.observe(hud, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
    const onPre = () => preRenders++,
      onPost = () => postRenders++,
      onResize = () => resizes++;
    viewer.addEventListener('preRender', onPre);
    viewer.addEventListener('postRender', onPost);
    viewer.renderManager.addEventListener('resize', onResize);
    const frames = [],
      selected = [],
      selectedAt = new Set([0, 9, 19, 29, 39, 47]);
    let previous = null,
      lastAt = performance.now();
    const round = (value) => Math.round(value * 1e6) / 1e6;
    const comparePixels = (pixels, previousPixels) => {
      let total = 0;
      let changed = 0;
      let max = 0;

      if (!previousPixels) {
        return { total, changed, max };
      }

      for (let offset = 0; offset < pixels.length; offset += 4) {
        const redDifference = Math.abs(pixels[offset] - previousPixels[offset]);
        const greenDifference = Math.abs(pixels[offset + 1] - previousPixels[offset + 1]);
        const blueDifference = Math.abs(pixels[offset + 2] - previousPixels[offset + 2]);
        total += redDifference + greenDifference + blueDifference;
        const localMaximum = Math.max(redDifference, greenDifference, blueDifference);

        if (localMaximum > 8) {
          changed++;
        }

        if (localMaximum > max) {
          max = localMaximum;
        }
      }

      return { total, changed, max };
    };

    try {
      for (let index = 0; index < 48; index++) {
        await new Promise(requestAnimationFrame);
        const at = performance.now(),
          camera = viewer.scene.mainCamera,
          state = window.__KITE_BOW_GAME__.getState();
        context.drawImage(canvas, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        const { total, changed, max } = comparePixels(pixels, previous);

        let visibleMeshes = 0,
          totalMeshes = 0;
        viewer.scene.traverse((object) => {
          if (object.isMesh) {
            totalMeshes++;
            let visible = object.visible,
              parent = object.parent;

            while (visible && parent) {
              visible = parent.visible;
              parent = parent.parent;
            }

            if (visible) {
              visibleMeshes++;
            }
          }
        });
        const runtimeRoots = viewer.scene.children.filter(
          (object) => object.name === 'K3D_BOW_RUNTIME',
        ).length;
        const arenaRoots = [];
        viewer.scene.traverse((object) => {
          if (object.name === 'K3D_BOW_RUNTIME_ARENA') {
            arenaRoots.push(object.uuid);
          }
        });
        frames.push({
          index,
          at: round(at),
          frameGapMs: round(at - lastAt),
          pixelDiff: previous
            ? {
                meanAbs: round(total / (width * height * 3)),
                changedFraction: round(changed / (width * height)),
                maxAbs: max,
              }
            : null,
          canvas: {
            width: canvas.width,
            height: canvas.height,
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            dpr: devicePixelRatio,
            rendererPixelRatio: viewer.renderManager.renderer.getPixelRatio(),
            renderScale: viewer.renderManager.renderScale,
          },
          camera: {
            position: camera.position.toArray().map(round),
            quaternion: camera.quaternion.toArray().map(round),
          },
          scene: {
            childCount: viewer.scene.children.length,
            totalMeshes,
            visibleMeshes,
            runtimeRoots,
            arenaRoots,
          },
          render: {
            preRenders,
            postRenders,
            resizes,
            frameCount: viewer.renderManager.frameCount,
            totalFrameCount: viewer.renderManager.totalFrameCount,
            msaa: viewer.renderManager.msaa,
            toneMapping: viewer.renderManager.renderer.toneMapping,
            background: viewer.scene.background?.getHex?.() ?? null,
            fogDensity: viewer.scene.fog?.density ?? null,
          },
          hud: {
            mutationRecords: domMutations,
            modalDisplay: hud?.querySelectorAll('div')[10]?.style.display ?? null,
          },
          gameplay: {
            mode: state.mode,
            elapsed: state.elapsed,
            arrowsInFlight: state.arrowsInFlight,
            remotePlayers: state.remotePlayers.length,
          },
        });
        if (selectedAt.has(index)) {
          selected.push({ index, url: copy.toDataURL('image/png') });
        }
        previous = new Uint8ClampedArray(pixels);
        lastAt = at;
      }
    } finally {
      observer.disconnect();
      viewer.removeEventListener('preRender', onPre);
      viewer.removeEventListener('postRender', onPost);
      viewer.renderManager.removeEventListener('resize', onResize);
    }

    const debug = viewer.renderManager.renderer
        .getContext()
        .getExtension('WEBGL_debug_renderer_info'),
      gl = viewer.renderManager.renderer.getContext();
    const gpu = {
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    };
    const sheet = document.createElement('canvas');
    sheet.width = width * 3;
    sheet.height = height * 2;
    const sheetContext = sheet.getContext('2d');
    sheetContext.fillStyle = '#111';
    sheetContext.fillRect(0, 0, sheet.width, sheet.height);
    await Promise.all(
      selected.map(
        ({ index, url }, slot) =>
          new Promise((ok, fail) => {
            const image = new Image();

            image.onload = () => {
              const x = (slot % 3) * width,
                y = Math.floor(slot / 3) * height;
              sheetContext.drawImage(image, x, y, width, height);
              sheetContext.fillStyle = '#000b';
              sheetContext.fillRect(x, y, 74, 20);
              sheetContext.fillStyle = '#fff';
              sheetContext.font = '12px monospace';
              sheetContext.fillText(`frame ${index}`, x + 6, y + 14);
              ok();
            };

            image.onerror = fail;
            image.src = url;
          }),
      ),
    );

    return { scenario: scenarioName, gpu, frames, contactSheet: sheet.toDataURL('image/png') };
  }, scenario);
}

function summarize(result) {
  const measured = result.frames.slice(1),
    diffs = measured
      .map((frame) => frame.pixelDiff.meanAbs)
      .sort((firstValue, secondValue) => firstValue - secondValue),
    changed = measured
      .map((frame) => frame.pixelDiff.changedFraction)
      .sort((firstValue, secondValue) => firstValue - secondValue),
    gaps = result.frames
      .map((frame) => frame.frameGapMs)
      .sort((firstValue, secondValue) => firstValue - secondValue);
  const at = (values, point) =>
      values[Math.min(values.length - 1, Math.floor(values.length * point))] ?? 0,
    first = result.frames[0],
    last = result.frames.at(-1);

  return {
    scenario: result.scenario,
    gpu: result.gpu,
    frames: result.frames.length,
    pixelDiff: {
      meanP50: at(diffs, 0.5),
      meanP95: at(diffs, 0.95),
      max: diffs.at(-1) ?? 0,
      changedP50: at(changed, 0.5),
      changedP95: at(changed, 0.95),
      changedMax: changed.at(-1) ?? 0,
    },
    frameGapMs: { p50: at(gaps, 0.5), p95: at(gaps, 0.95), max: gaps.at(-1) ?? 0 },
    canvasVariants: [...new Set(result.frames.map((frame) => JSON.stringify(frame.canvas)))].map(
      (value) => JSON.parse(value),
    ),
    cameraVariants: new Set(result.frames.map((frame) => JSON.stringify(frame.camera))).size,
    visibleMeshVariants: [...new Set(result.frames.map((frame) => frame.scene.visibleMeshes))],
    sceneChildVariants: [...new Set(result.frames.map((frame) => frame.scene.childCount))],
    runtimeRootVariants: [...new Set(result.frames.map((frame) => frame.scene.runtimeRoots))],
    arenaRootVariants: [...new Set(result.frames.map((frame) => frame.scene.arenaRoots.length))],
    renders: {
      pre: last.render.preRenders - first.render.preRenders,
      post: last.render.postRenders - first.render.postRenders,
      resizes: last.render.resizes - first.render.resizes,
    },
    hudMutationRecords: last.hud.mutationRecords,
  };
}

try {
  const workerOutput = [];

  if (!baseURL) {
    const port = await freePort();
    baseURL = `http://127.0.0.1:${port}`;
    worker = spawn(
      resolve(root, 'node_modules/.bin/wrangler'),
      ['dev', '--local', '--port', String(port), '--log-level', 'warn'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    worker.stdout.on('data', (chunk) => workerOutput.push(String(chunk)));
    worker.stderr.on('data', (chunk) => workerOutput.push(String(chunk)));
    await waitForWorker(baseURL, worker);
  }

  const launched = await launchBrowser();
  browser = launched.instance;
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
    results = [],
    errors = [];
  const solo = await context.newPage();
  errors.push(...(await enter(solo, `${baseURL}/?solo=1`, null)));
  results.push(await capture(solo, 'solo-one-client'));
  await solo.close();
  const onlineOne = await context.newPage();
  errors.push(...(await enter(onlineOne, `${baseURL}/?online=1`, 'Probe-One')));
  results.push(await capture(onlineOne, 'online-one-client'));
  await onlineOne.close();
  const pageA = await context.newPage(),
    pageB = await context.newPage();
  errors.push(...(await enter(pageA, `${baseURL}/?online=1`, 'Probe-A')));
  errors.push(...(await enter(pageB, `${baseURL}/?online=1`, 'Probe-B')));
  await Promise.all([
    pageA.waitForFunction(() => window.__KITE_BOW_GAME__.getState().remotePlayers.length === 1),
    pageB.waitForFunction(() => window.__KITE_BOW_GAME__.getState().remotePlayers.length === 1),
  ]);
  await pageA.bringToFront();
  await pageA.waitForTimeout(1000);
  results.push(await capture(pageA, 'online-two-clients'));
  await context.close();
  await mkdir(evidenceDir, { recursive: true });
  const report = {
    label,
    baseURL,
    backendAttempt: launched.backendAttempt,
    launchArgs: launched.launchArgs,
    launchFailures: launched.failures,
    summaries: results.map(summarize),
    scenarios: results.map((result) => ({
      scenario: result.scenario,
      gpu: result.gpu,
      frames: result.frames,
    })),
    consoleErrors: errors,
    workerOutput: workerOutput.filter((line) => /error|exception/i.test(line)).slice(-20),
  };
  await writeFile(
    resolve(evidenceDir, `flicker-${label}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  const contact = results.find((result) => result.scenario === 'online-two-clients') ?? results[0];
  await writeFile(
    resolve(evidenceDir, `flicker-${label}.png`),
    Buffer.from(contact.contactSheet.split(',')[1], 'base64'),
  );
  console.log(
    JSON.stringify(
      {
        evidence: `evidence/flicker-${label}.json`,
        contactSheet: `evidence/flicker-${label}.png`,
        backendAttempt: launched.backendAttempt,
        summaries: report.summaries,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await stopWorker(worker);
}
