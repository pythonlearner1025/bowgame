/** Specifies module-relative browser asset URL resolution. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bowAssetUrl } from '../scripts/BowAssetUrl.js';

test('Bow asset URLs resolve beside scripts in the project asset directory', () => {
  const url = new URL(bowAssetUrl('bow-audio/release-recorded.wav'));

  assert.equal(url.protocol, 'file:');
  assert.ok(url.pathname.endsWith('/assets/bow-audio/release-recorded.wav'));
});
