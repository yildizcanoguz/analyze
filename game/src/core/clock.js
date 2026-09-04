// Time. Speed is deliberate: the game gets slower as stakes rise, and it stops
// dead when something you cannot undo is on the table.

import { S } from './state.js';
import { emit } from './bus.js';

export const SPEEDS = [0, 1400, 700, 340, 150, 60]; // ms per in-game day
let acc = 0;
let lastForcePause = null;

export function setSpeed(n) {
  S.speed = Math.max(1, Math.min(5, n | 0));
  emit('clock:speed', S.speed);
}
export function togglePause(reason = null) { S.paused ? resume() : pause(reason); }
export function pause(reason = null) {
  if (S.paused) return;
  S.paused = true; lastForcePause = reason;
  emit('clock:pause', reason);
}
export function resume() {
  if (!S.paused) return;
  S.paused = false; lastForcePause = null;
  emit('clock:resume');
}
export function pauseReason() { return lastForcePause; }

/** Advance wall-clock ms; emits `tick` per in-game day elapsed. */
export function advance(dtMs, onDay) {
  if (S.paused) return 0;
  const per = SPEEDS[S.speed] || 700;
  acc += dtMs;
  let days = 0;
  while (acc >= per && days < 12) { acc -= per; S.day++; days++; onDay(S.day); }
  if (days) emit('clock:day', S.day);
  return days;
}
export function resetAccumulator() { acc = 0; }
