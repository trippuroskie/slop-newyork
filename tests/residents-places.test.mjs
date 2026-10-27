/** Seeded sampling uses real Midtown coordinate bounds and separated building doors. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlaces } from '../js/residents/places.js';
import { ALL_AVENUES, streetZ } from '../js/city-config.js';

test('places are reproducible, separated, labeled and include landmarks', () => {
  const west = ALL_AVENUES.find((avenue) => avenue.id === '6').x;
  const east = ALL_AVENUES.find((avenue) => avenue.id === 'lex').x;
  const colliders = [];
  for (let x = west + 25; x < east - 20; x += 70) {
    for (let z = streetZ(42) + 25; z < streetZ(34) - 20; z += 70) {
      colliders.push({
        minX: x - 10,
        maxX: x + 10,
        minZ: z - 10,
        maxZ: z + 10,
        minY: 0,
        maxY: colliders.length % 3 === 0 ? 120 : 25,
      });
    }
  }
  const places = makePlaces({ colliders });
  assert.deepEqual(places, makePlaces({ colliders }));
  assert.equal(new Set(places.map((place) => place.label)).size, places.length);
  const buildings = places.filter((place) => place.footprint);
  for (const [index, place] of buildings.entries()) {
    for (const other of buildings.slice(index + 1)) {
      assert.ok(Math.hypot(place.x - other.x, place.z - other.z) >= 60);
    }
  }
  assert.ok(
    buildings.filter((place) => place.kind === 'office').every((place) => place.height === 120),
  );
  for (const name of ['Bryant Park', 'Grand Central Terminal', 'Empire State Building']) {
    assert.ok(places.some((place) => place.label === name));
  }
});
