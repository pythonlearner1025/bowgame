/** Specifies server-side rolling telemetry aggregation and snapshot behavior. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function importBundled(entry) {
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });

  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
}

const client = await importBundled('src/BowPerformance.ts'),
  room = await importBundled('worker/roomTelemetry.ts');

test('telemetry UTF-8 byte counts cover ASCII, BMP, and surrogate pairs', () => {
  assert.equal(client.utf8ByteLength('state'), 5);
  assert.equal(client.utf8ByteLength('é'), 2);
  assert.equal(client.utf8ByteLength('🏹'), 4);
  assert.equal(room.utf8MessageBytes('Aé🏹'), 7);
});

test('per-second frame summaries calculate p50, p95, and max', () => {
  assert.deepEqual(client.summarizeFrameTimes([4, 1, 3, 2]), { count: 4, p50: 3, p95: 4, max: 4 });
  assert.deepEqual(client.summarizeFrameTimes([]), { count: 0, p50: 0, p95: 0, max: 0 });
});

test('telemetry ring retains chronological values up to capacity', () => {
  const ring = new client.TelemetryRing(3);
  ring.push(1);
  ring.push(2);
  ring.push(3);
  ring.push(4);
  assert.deepEqual(ring.toArray(), [2, 3, 4]);
  assert.equal(ring.length, 3);
});

test('room telemetry emits a payload-free 60-second aggregate', () => {
  const entries = [],
    telemetry = new room.RoomTelemetry((entry, error) => entries.push({ entry, error }), 1_000);
  telemetry.recordInbound('state', 123);
  telemetry.recordInbound('state', 123);
  telemetry.recordOutbound('state', 150, 3, true);
  assert.equal(telemetry.flushIfDue(2, 60_999), null);
  const summary = telemetry.flushIfDue(2, 61_000);
  assert.ok(summary);
  assert.equal(summary.inboundMessagesByType.state.count, 2);
  assert.equal(summary.inboundMessagesByType.state.bytes, 246);
  assert.equal(summary.outboundMessagesByType.state.count, 3);
  assert.equal(summary.outboundMessagesByType.state.bytes, 450);
  assert.equal(summary.broadcastFanOut, 3);
  assert.equal(summary.maxMessageBytes, 150);
  assert.equal(summary.connectedCount, 2);
  assert.equal(entries.length, 1);
  assert.equal('payload' in summary, false);
});
