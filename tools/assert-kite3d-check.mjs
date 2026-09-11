/** Requires Kite3D's browser-backed Playable, Editable, and Persisted checks to pass. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('.kite3d/check.json', 'utf8'));
assert.equal(report.ok, true, 'Kite3D static and runtime checks succeeded');
assert.equal(report.mode, 'headless', 'Kite3D check ran without an attached editor');

const requiredOutcomes = ['Playable', 'Editable', 'Persisted'];
for (const name of requiredOutcomes) {
  const outcome = report.outcomes.find((candidate) => candidate.name === name);
  assert.ok(outcome, `${name} outcome exists`);
  assert.equal(outcome.status, 'pass', `${name} is a real browser-backed pass`);
}

console.log('verified Kite3D headless outcomes: Playable=pass, Editable=pass, Persisted=pass');
