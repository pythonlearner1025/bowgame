/** Specifies deterministic synthesis, spatial whizz detection, and audio lifecycle behavior. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const bundled = await build({
  entryPoints: ['src/BowAudio.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const temporary = await mkdtemp(join(tmpdir(), 'kite3d-bow-audio-'));
after(() => rm(temporary, { recursive: true, force: true }));
await writeFile(join(temporary, 'audio.mjs'), bundled.outputFiles[0].text);
const {
  BowAudio,
  renderBowSound,
  shouldArrowWhizz,
  BOW_AUDIO_VOICES,
  BOW_AUDIO_MIX,
  BOW_RECORDED_AUDIO,
  BOW_RECORDED_MIX,
} = await import(pathToFileURL(join(temporary, 'audio.mjs')));
const sounds = ['draw', 'body', 'head', 'cover'];

function rms(samples) {
  return Math.sqrt(samples.reduce((sample, value) => sample + value * value, 0) / samples.length);
}

test('original foley PCM is finite, bounded and head crack is stronger than body impact', () => {
  for (const kind of sounds) {
    const data = renderBowSound(kind);
    assert.ok(data.length >= 4800 && data.length <= 24000);
    assert.ok(data.every((value) => Number.isFinite(value) && Math.abs(value) < 0.95));
    assert.ok(rms(data) > 0.01);
    assert.ok(data[0] === 0);
    assert.ok(Math.abs(data.at(-1)) < 0.01);
  }

  assert.ok(
    rms(renderBowSound('head')) > rms(renderBowSound('body')) * 1.15,
    'headshot should be distinct and louder than body impact',
  );
  assert.notDeepEqual(renderBowSound('head'), renderBowSound('cover'));
});
test('served recordings retain quiet PCM levels, faded edges and documented provenance', async () => {
  const provenance = JSON.parse(await readFile('assets/bow-audio/PROVENANCE.json', 'utf8'));

  for (const kind of ['release', 'whizz']) {
    const bytes = await readFile(BOW_RECORDED_AUDIO[kind].replace('/kite/', '')),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let start = 0,
      length = 0;

    for (let i = 12; i + 8 < bytes.length;) {
      const size = view.getUint32(i + 4, true);

      if (bytes.toString('ascii', i, i + 4) === 'data') {
        start = i + 8;
        length = size / 2;
        break;
      }

      i += 8 + size + (size % 2);
    }

    assert.ok(start && length);
    const pcm = Float32Array.from(
        { length },
        (unusedValue, i) => view.getInt16(start + i * 2, true) / 32768,
      ),
      peak = Math.max(...pcm.map(Math.abs));
    assert.ok(
      peak < (kind === 'release' ? 0.2 : 0.05),
      'processed samples must not be normalized back to full scale',
    );
    assert.ok(
      Math.abs(pcm[0]) < 0.001 && Math.abs(pcm.at(-1)) < 0.001,
      'edge fades remove cut clicks',
    );
    const effective = rms(pcm) * BOW_RECORDED_MIX[kind];
    assert.ok(
      effective < (kind === 'release' ? 0.03 : 0.008),
      'recorded route must be markedly quieter than previous synthesized route',
    );
    const source = provenance.sources.find((item) => item.kind === kind);
    assert.equal(source.license, 'CC0-1.0');
    assert.ok(source.url.startsWith('https://freesound.org/people/'));
    assert.equal(source.filename, BOW_RECORDED_AUDIO[kind].split('/').at(-1));
  }
});
test('near miss requires a real segment passing beside the listener', () => {
  const listener = { x: 0, y: 1.6, z: 0 },
    point = (x, y, z) => ({ x, y, z });
  assert.equal(shouldArrowWhizz(point(-1, 1.6, -0.2), point(-1, 1.6, 0.2), listener), true);
  assert.equal(
    shouldArrowWhizz(point(-1, 1.6, -3), point(-1, 1.6, -2), listener),
    false,
    'approaching but not yet passing must not whizz',
  );
  assert.equal(shouldArrowWhizz(point(4, 1.6, -0.2), point(4, 1.6, 0.2), listener), false);
  assert.equal(
    shouldArrowWhizz(point(0, 1.6, -0.2), point(0, 1.6, 0.2), listener),
    false,
    'direct hit is not a near miss',
  );
  assert.equal(shouldArrowWhizz(listener, listener, listener), false);
});
class Param {
  value = 0;
  setTargetAtTime(value) {
    this.value = value;
  }
  setValueAtTime(value) {
    this.value = value;
  }
  linearRampToValueAtTime(value) {
    this.value = value;
  }
  cancelScheduledValues() {}
}
class Node {
  gain = new Param();
  pan = new Param();
  playbackRate = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start() {}
  stop(time) {
    this.stopTime = time;
    this.onended?.();
  }
}
let contexts = 0,
  fetches = 0,
  decodes = 0,
  failDecode = false,
  deferDecode = false;
const deferred = [];

globalThis.fetch = async (path) => {
  fetches++;
  const bytes = await readFile(path.replace('/kite/', ''));

  return {
    ok: true,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};

function wavInfo(bytes) {
  const view = new DataView(bytes);
  let channels = 0,
    rate = 0,
    bits = 0,
    length = 0;
  assert.equal(Buffer.from(bytes, 0, 4).toString(), 'RIFF');

  for (let i = 12; i + 8 <= view.byteLength;) {
    const tag = Buffer.from(bytes, i, 4).toString(),
      size = view.getUint32(i + 4, true);

    if (tag === 'fmt ') {
      channels = view.getUint16(i + 10, true);
      rate = view.getUint32(i + 12, true);
      bits = view.getUint16(i + 22, true);
    }

    if (tag === 'data') {
      length = size / ((channels * bits) / 8);
    }
    i += 8 + size + (size % 2);
  }

  assert.ok(channels && rate && length);

  return { channels, rate, length };
}

class Context {
  state = 'suspended';
  currentTime = 0;
  destination = new Node();
  constructor() {
    this.id = ++contexts;
  }
  createGain() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createWaveShaper() {
    return new Node();
  }
  createStereoPanner() {
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createBuffer(channels, length, rate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      duration: length / rate,
      copyToChannel() {},
    };
  }
  async decodeAudioData(bytes) {
    decodes++;
    if (failDecode) {
      throw new Error('decode rejected');
    }
    if (deferDecode) {
      await new Promise((resolve) => deferred.push(resolve));
    }
    const { channels, rate, length } = wavInfo(bytes);

    return { ...this.createBuffer(channels, length, rate), contextId: this.id };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}
globalThis.AudioContext = Context;
test('audio has one context, bounded voices/loops, distinct head route, mute and cleanup', async () => {
  contexts = 0;
  const audio = new BowAudio();
  audio.release();
  assert.equal(contexts, 0, 'no autoplay context before gesture');
  await audio.resume();
  await audio.resume();
  assert.equal(contexts, 1);
  assert.equal(audio.getState().buffers.length, 6);
  assert.equal(fetches, 2);
  assert.equal(decodes, 2);
  assert.ok(
    Object.values(audio.getState().recordings).every((record) => record.status === 'decoded'),
  );
  assert.equal(
    audio.getState().buffers.filter((secondValue) => secondValue.source === 'recorded').length,
    2,
  );
  assert.ok(
    audio.limiter.curve.every((value) => Math.abs(value) < 0.88),
    'final soft limiter must stay below full-scale',
  );
  audio.draw(-1, 0.4);
  const drawStarts = audio.getState().played.draw;
  for (let i = 0; i < 30; i++) {
    audio.draw(-1, 0.8);
  }
  assert.equal(audio.getState().played.draw, drawStarts, 'charge updates must reuse one source');
  audio.draw(-1, 0);
  assert.equal(audio.getState().drawLoops, 0);
  audio.impact({ x: 0, y: 0, z: 0 }, 'head');
  assert.equal(audio.getState().played.head, 1);
  assert.equal(audio.getState().played.body, 0);
  audio.headshotConfirm();
  assert.equal(audio.getState().headshotConfirmations, 1);
  assert.equal(audio.getState().played.head, 2);
  assert.equal(audio.voices.at(-1).gain.gain.value, 1.04, 'local confirmation must remain bounded');
  for (let i = 0; i < 100; i++) {
    audio.release();
  }
  assert.ok(audio.getState().voices <= BOW_AUDIO_VOICES);
  for (let i = 0; i < 20; i++) {
    audio.draw(i, 0.8);
  }
  assert.ok(audio.getState().drawLoops <= 7);
  audio.setMuted(true);
  assert.equal(audio.master.gain.value, 0);
  audio.setVolume(8);
  assert.equal(audio.getState().volume, 0.8);
  audio.suspend();
  const before = audio.getState().played.release;
  audio.release();
  assert.equal(audio.getState().played.release, before);
  assert.equal(audio.getState().drawLoops, 0);
  audio.dispose();
  assert.equal(audio.getState().voices, 0);
  assert.equal(audio.getState().buffers.length, 0);
  assert.equal(audio.getState().state, 'uninitialized');
});
test('draw softens near completion and a fully held bow stays silent without restarting a loop', async () => {
  const audio = new BowAudio();
  await audio.resume();
  audio.draw(-1, 0.6);
  const voice = audio.voices[0],
    workingGain = voice.gain.gain.value;
  assert.ok(workingGain < 0.13, 'draw should be substantially quieter than the previous .214 gain');
  audio.draw(-1, 0.92);
  assert.ok(
    voice.gain.gain.value < workingGain * 0.4,
    'last draw movement should fade toward silence',
  );
  const starts = audio.getState().played.draw;
  audio.draw(-1, 0.97);
  assert.equal(audio.getState().drawLoops, 0);
  assert.equal(audio.getState().voices, 0);
  for (let i = 0; i < 90; i++) {
    audio.draw(-1, 1);
  }
  assert.equal(audio.getState().played.draw, starts, 'holding full draw must not recreate sources');
  assert.equal(audio.getState().drawLoops, 0);
  assert.equal(audio.getState().voices, 0);
  audio.draw(-1, 0.2);
  assert.equal(audio.getState().played.draw, starts + 1, 'a new draw should be audible again');
  audio.dispose();
});
test('recorded release is a single quiet voice and a distant near miss is softer', async () => {
  const audio = new BowAudio();
  await audio.resume();
  const requests = fetches,
    decoded = decodes;
  audio.release();
  assert.equal(audio.getState().played.release, 1);
  assert.equal(audio.getState().played.flight, 0, 'no duplicated launch swish');
  assert.equal(audio.getState().voices, 1);
  assert.equal(audio.voices[0].source.buffer, audio.buffers.get('release'));
  assert.equal(audio.voices[0].gain.gain.value, BOW_RECORDED_MIX.release);
  assert.equal(audio.voices[0].source.playbackRate.value, 1, 'keep recorded release pitch');
  const point = (x, z) => ({ x, y: 0, z });
  assert.equal(audio.whizz(point(0.5, -1), point(0.5, 1)), true);
  const closeGain = audio.voices.at(-1).gain.gain.value;
  assert.equal(audio.whizz(point(2, -1), point(2, 1)), true);
  assert.ok(audio.voices.at(-1).gain.gain.value < closeGain * 0.3);
  assert.ok(closeGain < BOW_RECORDED_MIX.whizz);
  assert.equal(fetches, requests);
  assert.equal(decodes, decoded, 'shot/pass paths never decode');
  audio.dispose();
});
test('body and head confirmation keep their accepted modest boost', async () => {
  assert.ok(
    rms(renderBowSound('body')) > 0.1113 * 1.1 && rms(renderBowSound('body')) < 0.1115 * 1.25,
    'body impact gains about1–2dB',
  );
  const audio = new BowAudio();
  await audio.resume();
  audio.impact({ x: 0, y: 0, z: 0 }, 'head');
  assert.ok(
    audio.voices.at(-1).gain.gain.value > 1.2 && audio.voices.at(-1).gain.gain.value <= 1.3,
  );
  audio.headshotConfirm();
  assert.ok(audio.voices.at(-1).gain.gain.value > 1 && audio.voices.at(-1).gain.gain.value < 1.08);
  assert.equal(audio.getState().volume, 0.6, 'master level stays unchanged');
  audio.dispose();
});
test('dispose fades before closing only its retiring context', async () => {
  const audio = new BowAudio();
  await audio.resume();
  audio.release();
  const oldContext = audio.context,
    oldMaster = audio.master,
    source = audio.voices[0].source;
  audio.dispose();
  assert.ok(
    source.stopTime >= oldContext.currentTime + 0.035,
    'source must stop after the35ms fade',
  );
  assert.equal(oldMaster.gain.value, 0);
  assert.equal(oldContext.state, 'running', 'old graph must not close at a nonzero sample');
  await audio.resume();
  const nextContext = audio.context;
  assert.notEqual(nextContext, oldContext);
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(oldContext.state, 'closed');
  assert.equal(nextContext.state, 'running', 'retiring timer must not close the resumed context');
  assert.equal(oldMaster.disconnected, true);
  audio.dispose();
});
test('recording decode failure stays silent instead of restoring synthetic swishes', async () => {
  failDecode = true;
  const audio = new BowAudio();
  await audio.resume();
  failDecode = false;
  assert.equal(audio.getState().buffers.length, 4);
  assert.ok(
    Object.values(audio.getState().recordings).every((record) => record.status === 'failed'),
  );
  audio.release();
  assert.equal(audio.whizz({ x: 1, y: 0, z: -1 }, { x: 1, y: 0, z: 1 }), false);
  assert.equal(audio.getState().voices, 0);
  audio.draw(-1, 0.5);
  assert.equal(audio.getState().drawLoops, 1, 'accepted procedural draw still works');
  audio.dispose();
});
test('failed network fetch is reported and never creates synthetic replacement voices', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });

  try {
    const { BowAudio: UncachedAudio } = await import(
      pathToFileURL(join(temporary, 'audio.mjs')) + '?network-failure'
    );
    const audio = new UncachedAudio();
    await audio.resume();
    assert.ok(
      Object.values(audio.getState().recordings).every((record) => record.status === 'failed'),
    );
    audio.release();
    assert.equal(audio.getState().voices, 0);
    audio.dispose();
  } finally {
    globalThis.fetch = previousFetch;
  }
});
test('late decode cannot overwrite a disposed or resumed audio graph', async () => {
  const audio = new BowAudio();
  deferDecode = true;
  const pending = audio.resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deferred.length, 2);
  audio.dispose();
  deferDecode = false;
  await audio.resume();
  const context = audio.context;
  for (const resolve of deferred.splice(0)) {
    resolve();
  }
  await pending;
  assert.ok(
    [...audio.buffers]
      .filter(([kind]) => kind in BOW_RECORDED_AUDIO)
      .every(([, buffer]) => buffer.contextId === context.id),
  );
  assert.equal(audio.getState().recordings.release.status, 'decoded');
  audio.dispose();
});

if (process.env.BOW_AUDIO_EXPORT_DIR) {
  const dir = process.env.BOW_AUDIO_EXPORT_DIR;
  await mkdir(dir, { recursive: true });
  const info = [];

  for (const kind of sounds) {
    const data = renderBowSound(kind),
      buffer = Buffer.alloc(44 + data.length * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(24000, 24);
    buffer.writeUInt32LE(48000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(data.length * 2, 40);
    data.forEach((value, i) => buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2));
    await writeFile(join(dir, kind + '.wav'), buffer);
    info.push({
      kind,
      duration: data.length / 24000,
      peak: Math.max(...data.map(Math.abs)),
      rms: rms(data),
    });
  }

  await writeFile(
    join(dir, 'metadata.json'),
    JSON.stringify(
      {
        origin:
          'Original procedural PCM from BowAudio.renderBowSound; procedural subset used by browser, excluding recorded release/flyby; before positional gain/master compression/limiting',
        sampleRate: 24000,
        channels: 1,
        mix: BOW_AUDIO_MIX,
        sounds: info,
      },
      null,
      2,
    ) + '\n',
  );
}
