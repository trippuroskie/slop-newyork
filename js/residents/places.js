/** Seeded Midtown building selection, door anchors and approximate sidewalk routes. */
import { ALL_AVENUES, ALL_STREETS, streetZ, TELEPORT_LOCATIONS } from '../city-config.js';
export function makePlaces(cityBlocks) {
  const west = ALL_AVENUES.find((avenue) => avenue.id === '6').x;
  const east = ALL_AVENUES.find((avenue) => avenue.id === 'lex').x;
  let seed = 3742;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const candidates = cityBlocks.colliders
    .filter((building) => building.minY < 1 && building.maxY > 8 && !building.obb)
    .map((building) => ({
      ...building,
      x: (building.minX + building.maxX) / 2,
      z: (building.minZ + building.maxZ) / 2,
      rank: random(),
    }))
    .filter(
      (building) =>
        building.x >= west &&
        building.x <= east &&
        building.z >= streetZ(42) &&
        building.z <= streetZ(34),
    )
    .sort((first, second) => first.rank - second.rank);
  const chosen = [];
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
  ];
  const heights = candidates
    .map((building) => building.maxY)
    .sort((first, second) => first - second);
  const towerHeight = heights[Math.floor(heights.length * 0.65)];
  for (const kind of kinds) {
    const eligible = candidates.filter(
      (building) =>
        !chosen.includes(building) &&
        (kind === 'office' ? building.maxY > towerHeight : building.maxY <= towerHeight) &&
        chosen.every((other) => Math.hypot(building.x - other.x, building.z - other.z) >= 60),
    );
    // Farthest-point sampling spreads homes across the whole area, with seeded ties.
    eligible.sort((first, second) => {
      const separation = (building) =>
        chosen.length
          ? Math.min(
              ...chosen.map((other) => Math.hypot(building.x - other.x, building.z - other.z)),
            )
          : building.rank;
      return separation(second) - separation(first);
    });
    if (!eligible.length) throw Error('Insufficient separated Midtown buildings');
    chosen.push(eligible[0]);
  }
  const labels = new Map();
  const places = chosen.map((candidate, index) => {
    const avenue = ALL_AVENUES.filter((first) => !first.isHighway).reduce((first, second) =>
      Math.abs(second.x - candidate.x) < Math.abs(first.x - candidate.x) ? second : first,
    );
    const street = ALL_STREETS.filter((selector) => selector.number).reduce((first, second) =>
      Math.abs(second.z - candidate.z) < Math.abs(first.z - candidate.z) ? second : first,
    );
    const sidewalkX = avenue.x + Math.sign(candidate.x - avenue.x) * ((avenue.width || 20) / 2 + 3);
    const sidewalkZ = street.z + Math.sign(candidate.z - street.z) * ((street.width || 18) / 2 + 3);
    const nearAvenue =
      Math.min(Math.abs(candidate.minX - sidewalkX), Math.abs(candidate.maxX - sidewalkX)) <
      Math.min(Math.abs(candidate.minZ - sidewalkZ), Math.abs(candidate.maxZ - sidewalkZ));
    const door = nearAvenue
      ? {
          x:
            Math.abs(candidate.minX - sidewalkX) < Math.abs(candidate.maxX - sidewalkX)
              ? candidate.minX - 1
              : candidate.maxX + 1,
          z: candidate.z,
        }
      : {
          x: candidate.x,
          z:
            Math.abs(candidate.minZ - sidewalkZ) < Math.abs(candidate.maxZ - sidewalkZ)
              ? candidate.minZ - 1
              : candidate.maxZ + 1,
        };
    const prefix =
      kinds[index] === 'office'
        ? 'Office tower'
        : kinds[index][0].toUpperCase() + kinds[index].slice(1);
    const baseLabel = `${prefix} · ${avenue.id === '6' ? '6th Ave' : avenue.name} & ${candidate.x < 0 ? 'W' : 'E'} ${street.number}${street.number === 41 ? 'st' : street.number === 42 ? 'nd' : 'th'} St`;
    const count = (labels.get(baseLabel) || 0) + 1;
    labels.set(baseLabel, count);
    return {
      id: `b-${candidate.minX.toFixed(2)}-${candidate.minZ.toFixed(2)}`,
      kind: kinds[index],
      label: baseLabel + (count > 1 ? ` · ${count}` : ''),
      x: candidate.x,
      z: candidate.z,
      height: candidate.maxY,
      footprint: {
        minX: candidate.minX,
        maxX: candidate.maxX,
        minZ: candidate.minZ,
        maxZ: candidate.maxZ,
      },
      door,
      sidewalk: nearAvenue ? { x: sidewalkX, z: candidate.z } : { x: candidate.x, z: sidewalkZ },
      junction: { x: sidewalkX, z: sidewalkZ },
    };
  });
  for (const [key, label] of [
    ['bryant', 'Bryant Park'],
    ['grandcentral', 'Grand Central Terminal'],
    ['empire', 'Empire State Building'],
  ]) {
    const point = TELEPORT_LOCATIONS[key];
    if (!point) continue;
    places.push({
      id: key,
      kind: key === 'bryant' ? 'park' : 'landmark',
      label,
      x: point.x,
      z: point.z,
      door: { ...point },
      sidewalk: { ...point },
      junction: { ...point },
    });
  }
  return places;
}
export function routeBetween(from, to) {
  return [
    from.sidewalk,
    from.junction,
    { x: to.junction.x, z: from.junction.z },
    to.junction,
    to.sidewalk,
    to.door,
  ].map((place) => ({ ...place }));
}
