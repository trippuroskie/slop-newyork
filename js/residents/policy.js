/** Deterministic offline policy and tolerant, bounded model decision parsing. */
export const actions = [
  'eat',
  'work',
  'socialize',
  'go_home',
  'sleep',
  'walk',
  'shop',
  'exercise',
  'idle',
];
export function mockDecisions(world) {
  const hour = Math.floor(((world.clock || 0) % 1440) / 60);
  return {
    decisions: world.residents.map((resident, index) => {
      let action =
        hour < 7 || hour >= 23
          ? 'sleep'
          : resident.needs.hunger > 65
            ? 'eat'
            : hour >= 9 && hour < 17
              ? 'work'
              : hour >= 17 && hour < 22
                ? 'socialize'
                : 'go_home';
      const kind = { eat: 'food', work: 'office', socialize: index % 2 ? 'bar' : 'park' }[action];
      const destination =
        action === 'work'
          ? resident.workplace
          : kind
            ? world.places.find((place) => place.kind === kind)?.id
            : resident.home;
      const phrases = {
        sleep: "I'm ready to curl up and sleep.",
        eat: "I'm hungry; time to find something tasty.",
        work: "I've got work to finish today.",
        socialize: "I'd love some company this evening.",
        go_home: "I'm heading home for a little quiet.",
      };
      return {
        id: resident.id,
        action,
        destination: destination || resident.home,
        thought: phrases[action],
      };
    }),
  };
}
/** Accept common local-model JSON envelopes; sanitize decisions without throwing. */
export function parseDecisions(text, world) {
  const errors = [];
  let data;
  try {
    const clean = String(text)
      .replace(/```(?:json)?/gi, '')
      .trim();
    const start = clean.search(/[\[{]/);
    const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
    data = JSON.parse(clean.slice(start, end + 1));
  } catch {
    errors.push('Invalid JSON');
  }
  const entries = Array.isArray(data) ? data : (data?.decisions ?? data?.residents);
  if (!Array.isArray(entries)) errors.push('Missing decisions');
  const seen = new Set();
  const fallback = mockDecisions(world).decisions;
  const placeAliases = new Map(world.places.map((place, index) => [`P${index + 1}`, place.id]));
  const decisions = [];
  for (const decision of Array.isArray(entries) ? entries : []) {
    const identity = String(decision?.id ?? decision?.name ?? '').toLowerCase();
    const resident = world.residents.find(
      (person, index) => person.id.toLowerCase() === identity ||
        person.name.toLowerCase() === identity || `r${index + 1}` === identity,
    );
    if (!resident || seen.has(resident.id)) {
      errors.push('Unknown or duplicate resident');
      continue;
    }
    seen.add(resident.id);
    const action = actions.includes(decision.action) ? decision.action : 'idle';
    const destinationId = placeAliases.get(decision.destination) || decision.destination;
    const given = world.places.find((place) => place.id === destinationId);
    const kinds = {
      eat: ['food', 'cafe'], work: ['office'], socialize: ['park', 'bar', 'cafe'],
      go_home: ['home'], sleep: ['home'], walk: ['park', 'landmark'],
      shop: ['shop'], exercise: ['gym', 'park'],
    }[action];
    const valid = given && (!kinds || kinds.includes(given.kind));
    if (!valid) errors.push(given ? 'Destination kind conflicts with action' : 'Unknown destination');
    const preferredId = action === 'work' ? resident.workplace : resident.home;
    const preferred = world.places.find((place) => place.id === preferredId && kinds?.includes(place.kind));
    const destination = valid ? given.id :
      (preferred || world.places.find((place) => kinds?.includes(place.kind)))?.id || resident.home;
    let thought = typeof decision.thought === 'string' ? decision.thought.trim() : '';
    const lower = thought.toLowerCase();
    if (!thought || /first person|chars|<=|resident|needs to/i.test(thought) ||
        (lower === `${resident.name.toLowerCase()} is` || lower.startsWith(`${resident.name.toLowerCase()} is `))) {
      errors.push('Invalid thought');
      thought = fallback.find((plan) => plan.id === resident.id).thought;
    }
    decisions.push({ id: resident.id, action, destination, thought: thought.slice(0, 100) });
  }
  if (decisions.length !== world.residents.length) errors.push('Missing resident decisions');
  return { decisions, parseError: errors.length ? errors.join('; ') : null };
}
