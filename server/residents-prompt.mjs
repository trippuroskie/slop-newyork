/** Compact batched planning prompt and inbound world validation. */
export { parseDecisions } from '../js/residents/policy.js';

function scheduleHint(resident, hour) {
  const schedule = resident.schedule || {};
  if (hour < (schedule.wake ?? 7) || hour >= 23) return 'should sleep';
  if ((schedule.meals || [8, 13, 19]).includes(hour))
    return hour === 13 ? 'lunch time' : 'meal time';
  if (hour >= (schedule.workStart ?? 9) && hour < (schedule.workEnd ?? 17))
    return 'should be at work now';
  return hour >= (schedule.workEnd ?? 17) ? 'evening free' : 'morning free';
}

export function buildPrompt(world) {
  const minute = Math.floor(world.clock % 1440);
  const hour = Math.floor(minute / 60);
  const day = Math.floor(world.clock / 1440);
  const weekday = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'][day % 7];
  const period = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'night';
  const aliases = new Map(world.places.map((place, index) => [place.id, `P${index + 1}`]));
  const alias = (id) => aliases.get(id) || '?';
  return {
    system: 'Plan city lives. Return JSON only, one entry per resident id (r1, r2, etc.). Actions: eat, work, socialize, go_home, sleep, walk, shop, exercise, idle. Destination must be a listed P-alias. Follow schedules and urgent needs (0 satisfied, 100 urgent). Prefer idle only when nothing else fits. Thought: own first-person inner voice, max 12 words; no third person or restating instructions. Example: {"decisions":[{"id":"r1","action":"work","destination":"P9","thought":"Coffee in hand, time to finish the lobby mockups."}]}',
    user: [
      `Day ${day + 1}, ${hour}:${String(minute % 60).padStart(2, '0')} (${weekday} ${period})`,
      ...world.places.map((place, index) => `P${index + 1} ${place.label} [${place.kind}]`),
      ...world.residents.map((resident, index) => {
        const schedule = resident.schedule || {};
        const needs = resident.needs;
        return `r${index + 1} ${resident.name}${resident.age == null ? '' : `, ${resident.age}`}, ${resident.personality || resident.occupation || 'city resident'} | home ${alias(resident.home)} work ${alias(resident.workplace)} | at ${alias(resident.location)} doing ${resident.action || 'idle'} | hunger ${Math.round(needs.hunger)} work ${Math.round(needs.work)} social ${Math.round(needs.social)} | wake ${schedule.wake ?? 7} work ${schedule.workStart ?? 9}-${schedule.workEnd ?? 17} meals ${(schedule.meals || [8, 13, 19]).join('/')} | ${scheduleHint(resident, hour)}`;
      }),
    ].join('\n'),
  };
}
export function validateSnapshot(world) {
  return (
    world &&
    Number.isFinite(world.clock) &&
    world.clock >= 0 &&
    Array.isArray(world.residents) &&
    world.residents.length > 0 &&
    world.residents.length <= 10 &&
    Array.isArray(world.places) &&
    world.places.length > 0 &&
    world.places.length <= 100 &&
    world.places.every(
      (place) => typeof place.id === 'string' && typeof place.label === 'string',
    ) &&
    world.residents.every(
      (resident) =>
        typeof resident.id === 'string' &&
        typeof resident.name === 'string' &&
        world.places.some((place) => place.id === resident.home) &&
        resident.needs &&
        ['hunger', 'work', 'social'].every((key) => Number.isFinite(resident.needs[key])),
    )
  );
}
