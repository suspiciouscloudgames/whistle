import type { Placed, World } from "./world.ts";
import { deriveStructures, type Structure } from "./terrain.ts";
import { deriveEnvironment, type Environment } from "./environment.ts";
import { isHole } from "./tile.ts";

export type WorldDerivation = {
  key: string;
  structures: Structure[];
  environment: Environment;
};

function remember<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return value;
}

export function createWorldDeriver() {
  const structuresCache = new Map<string, Structure[]>();
  const environmentCache = new Map<string, WorldDerivation>();
  return (world: World, objects: (Placed & { removed?: boolean })[] = world.objects): WorldDerivation => {
    const terrainKey = JSON.stringify([world.size, world.terrain]);
    const objectsKey = JSON.stringify(objects.filter((o) => !o.removed).map((o) => [o.asset, o.x, o.z]));
    const structureKey = terrainKey + objectsKey;
    const structures = structuresCache.get(structureKey) ?? remember(
      structuresCache, structureKey, deriveStructures(world, objects),
    );
    const key = terrainKey + JSON.stringify(structures);
    return environmentCache.get(key) ?? remember(environmentCache, key, {
      key,
      structures,
      environment: deriveEnvironment(world, structures),
    });
  };
}

export function samePlacement(a: World, b: World) {
  const terrain = (world: World) => world.terrain && {
    ...world.terrain,
    tiles: world.terrain.tiles.map((tile) => [tile.height, tile.surface, isHole(tile)]),
  };
  return JSON.stringify([a.size, terrain(a), a.objects]) === JSON.stringify([b.size, terrain(b), b.objects]);
}
