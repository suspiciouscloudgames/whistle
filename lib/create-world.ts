import { starterWorld } from "./world.ts";
import { generateTerrain } from "./terrain.ts";

export function createTerrainWorld() {
  const world = starterWorld();
  world.objects = [];
  world.terrain = generateTerrain(
    world.size,
    crypto.getRandomValues(new Uint32Array(1))[0],
  );
  return world;
}
