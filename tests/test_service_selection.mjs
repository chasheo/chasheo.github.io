import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseReachableService } from '../src/select-service.ts';

test('chooses a reachable fallback when the first entry is unavailable', async () => {
  assert.equal(await chooseReachableService(['a', 'b'], async base => base === 'b'), 'b');
});

test('keeps the first endpoint as an offline retry target if neither answers', async () => {
  assert.equal(await chooseReachableService(['a', 'b'], async () => false), 'a');
  assert.equal(await chooseReachableService([], async () => true), null);
});

test('does not wait for a stalled alternative after one entry is reachable', async () => {
  const chosen = await chooseReachableService(['a', 'b'], base => base === 'a' ? new Promise(() => {}) : Promise.resolve(true));
  assert.equal(chosen, 'b');
});
