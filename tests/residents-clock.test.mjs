/** Clock invariants independent of WebGL, frame rate and timer scheduling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallClock, isTickDue } from '../js/residents/clock.js';

test('wall time advances independently of render dt without double consumption', () => {
  const elapsed = createWallClock(0);
  let clock = 0;
  for (let time = 250; time <= 60000; time += 250) {
    clock += elapsed(time) * 20;
    assert.equal(elapsed(time), 0);
  }
  assert.equal(clock, 1200);
  assert.equal(elapsed(120000), 5);
  assert.equal(elapsed(120100), 0.1);
});

test('first tick, overdue resume and regular schedule', () => {
  assert.equal(isTickDue({ clock: 480, lastTick: 480, tickCount: 0 }, 60), true);
  assert.equal(isTickDue({ clock: 600, lastTick: 480, tickCount: 2 }, 60), true);
  assert.equal(isTickDue({ clock: 500, lastTick: 480, tickCount: 2 }, 60), false);
});
