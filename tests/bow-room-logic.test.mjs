/** Specifies authoritative room membership, scoring, and round transitions. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['worker/roomLogic.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const source = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const { RoomLogic, ROOM_CAP, SCORE_LIMIT } = await import(source);
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UPGRADE_REQUIRED = 426;

const originBundle = await build({
  entryPoints: ['worker/origin.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const originSource = `data:text/javascript;base64,${Buffer.from(originBundle.outputFiles[0].text).toString('base64')}`;
const { isAllowedBowOrigin, parseBowOrigin } = await import(originSource);

const workerBundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'cloudflare-worker-class',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: 'cloudflare-workers',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents:
            'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }',
          loader: 'js',
        }));
      },
    },
  ],
});
const workerSource = `data:text/javascript;base64,${Buffer.from(workerBundle.outputFiles[0].text).toString('base64')}`;
const { handleBowRequest } = await import(workerSource);

test('room caps membership at ten and reuses a departed player slot', () => {
  const room = new RoomLogic();
  for (let i = 0; i < ROOM_CAP; i++) {
    assert.equal(room.join(`p${i}`, `Archer-${i}`)?.slot, i);
  }
  assert.equal(room.join('overflow', 'Archer-X'), null);
  assert.equal(room.leave('p4'), true);
  assert.equal(room.players.size, 9);
  assert.equal(room.join('replacement', 'Archer-R')?.slot, 4);
  assert.equal(room.players.size, 10);
});

test('death is the only event that tallies a valid killer', () => {
  const room = new RoomLogic(),
    firstValue = room.join('a', 'A'),
    secondValue = room.join('b', 'B');
  assert.ok(firstValue && secondValue);
  assert.equal(room.scores().a, 0);
  assert.equal(room.death('b', 'missing').accepted, false);
  const result = room.death('b', 'a');
  assert.equal(result.accepted, true);
  assert.equal(result.scores.a, 1);
  assert.equal(result.winnerId, null);
});

test('twenty deaths end a round and further deaths do not score', () => {
  const room = new RoomLogic();
  room.join('a', 'A');
  room.join('b', 'B');
  let result;
  for (let i = 0; i < SCORE_LIMIT; i++) {
    result = room.death('b', 'a');
  }
  assert.equal(result.winnerId, 'a');
  assert.equal(room.roundEnded, true);
  assert.equal(room.scores().a, 20);
  assert.equal(room.death('b', 'a').accepted, false);
  assert.equal(room.scores().a, 20);
});

test('reset advances the round, clears kills, and permits play again', () => {
  const room = new RoomLogic(7);
  room.join('a', 'A');
  room.join('b', 'B');
  for (let i = 0; i < SCORE_LIMIT; i++) {
    room.death('b', 'a');
  }
  const reset = room.reset();
  assert.equal(reset.round, 8);
  assert.deepEqual(reset.scores, { a: 0, b: 0 });
  assert.equal(room.roundEnded, false);
  assert.equal(room.death('a', 'b').scores.b, 1);
});

test('leave removes a player and their score', () => {
  const room = new RoomLogic();
  room.join('a', 'A');
  room.join('b', 'B');
  room.death('b', 'a');
  assert.equal(room.leave('a'), true);
  assert.deepEqual(room.scores(), { b: 0 });
  assert.equal(room.leave('a'), false);
});

test('Origin policy accepts published tenants and loopback development ports', () => {
  const allowed = [
    'https://bow.app.blitz.dev',
    'https://nested.bow.app.blitz.dev',
    'https://bow.app.blitz.dev:443',
    'http://localhost:43173',
    'https://127.0.0.1:8443',
    'http://[::1]:54847',
  ];

  for (const origin of allowed) {
    assert.equal(isAllowedBowOrigin(origin), true, origin);
  }
});

test('Origin policy rejects missing, malformed, bare, lookalike, and non-HTTPS tenants', () => {
  const rejected = [
    null,
    'null',
    'not a url',
    'ftp://bow.app.blitz.dev',
    'https://app.blitz.dev',
    'https://bow..app.blitz.dev',
    'https://app.blitz.dev.evil.example',
    'http://bow.app.blitz.dev',
    'https://bow.app.blitz.dev:444',
    'https://example.com',
  ];

  for (const origin of rejected) {
    assert.equal(isAllowedBowOrigin(origin), false, String(origin));
  }
  assert.equal(parseBowOrigin('https://bow.app.blitz.dev/path'), null);
});

test('Worker checks path, Origin, and Upgrade before looking up a room', async () => {
  const calls = [];
  const env = {
    BOW_ROOM: {
      getByName(name) {
        calls.push(name);

        return { fetch: async () => new Response('room') };
      },
    },
  };
  const missingPath = await handleBowRequest(new Request('https://worker.example/'), env);
  const hostile = await handleBowRequest(
    new Request('https://worker.example/ws', { headers: { Origin: 'https://evil.example' } }),
    env,
  );
  const plainHttp = await handleBowRequest(
    new Request('https://worker.example/ws', {
      headers: { Origin: 'http://127.0.0.1:43173' },
    }),
    env,
  );
  const upgraded = await handleBowRequest(
    new Request('https://worker.example/ws?room=six', {
      headers: { Origin: 'http://127.0.0.1:43173', Upgrade: 'websocket' },
    }),
    env,
  );

  assert.equal(missingPath.status, HTTP_NOT_FOUND);
  assert.equal(hostile.status, HTTP_FORBIDDEN);
  assert.equal(plainHttp.status, HTTP_UPGRADE_REQUIRED);
  assert.equal(upgraded.status, HTTP_OK);
  assert.deepEqual(calls, ['six']);
});
