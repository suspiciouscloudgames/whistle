import { starterWorld } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";

export function createLabWorld() {
  const world = starterWorld();
  world.title = "UWB 샘플 · 풀 / 바위 / 물";
  world.objects = [];
  world.terrain = flatTerrain(world.size);
  for (const [start, surface] of [[1, "soft"], [5, "rough"], [9, "slick"]] as const) {
    for (const z of [5, 6]) for (const x of [start, start + 1]) {
      world.terrain.tiles[z * world.size + x].surface = surface;
    }
  }
  return world;
}
