/** Shared wall-clock cursor (five-second sleep cap): render frames and timer callbacks consume time only once. */
export function createWallClock(now = performance.now()) {
  let previousTime = now;
  return function elapsedSeconds(currentTime = performance.now()) {
    const seconds = Math.max(0, Math.min(5, (currentTime - previousTime) / 1000));
    previousTime = currentTime;
    return seconds;
  };
}

/** Tick zero runs immediately; restored overdue plans run on the next update. */
export function isTickDue(state, tickMinutes) {
  return state.tickCount === 0 || state.clock - state.lastTick >= tickMinutes;
}
