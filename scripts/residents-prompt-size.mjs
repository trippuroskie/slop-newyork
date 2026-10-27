/** Reproducible eight-person prompt budget, without network access or credentials. */
import { buildPrompt } from '../server/residents-prompt.mjs';
import { mockDecisions } from '../js/residents/policy.js';
const kinds = [
  ...Array(8).fill('home'),
  ...Array(3).fill('office'),
  'food',
  'food',
  'bar',
  'cafe',
  'gym',
  'shop',
  'shop',
  'park',
  'landmark',
  'landmark',
];
const places = kinds.map((kind, index) => ({
  id: `b-${index * 60}.00-${index * 34}.00`,
  kind,
  label: `${kind} · Madison Ave & E ${34 + (index % 9)}th St`,
}));
const world = {
  clock: 780,
  places,
  residents: ['Maya', 'Leo', 'Inez', 'Sam', 'Noor', 'Theo', 'June', 'Alex'].map((name, index) => ({
    id: `r${index + 1}`,
    name,
    age: 23 + index * 3,
    home: places[index].id,
    workplace: places[8 + (index % 3)].id,
    needs: { hunger: 65, work: 40, social: 30 },
    action: 'work',
    location: places[8 + (index % 3)].id,
    schedule: { wake: 7, workStart: 9, workEnd: 17, meals: [8, 13, 19], evening: 18 },
    personality: 'Designer who loves quiet parks',
  })),
  events: [],
};
const prompt = buildPrompt(world);
for (const section of ['system', 'user'])
  console.log(
    `${section}: ${prompt[section].length} chars; ~${Math.ceil(prompt[section].length / 4)} tokens`,
  );
const output = JSON.stringify(mockDecisions(world));
console.log(
  `expected output: ${output.length} chars; ~${Math.ceil(output.length / 4)} tokens; output limit: 900 tokens`,
);

console.log(`total input: ~${Math.ceil(prompt.system.length / 4) + Math.ceil(prompt.user.length / 4)} tokens (characters / 4 estimate)`);
