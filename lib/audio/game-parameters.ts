import type { World } from "../world.ts";
import type { WorldDerivation } from "../world-derivation.ts";
import { isHole } from "../tile.ts";
import type { EditSound, PlayerSound } from "./webpd-session.ts";

export type PlayerAudioFrame = {
  x: number; y: number; z: number; size: number;
  grass: number; rough: number; water: number;
  grounded: boolean; falling: boolean; yaw: number;
};

export function playerSound(frame: PlayerAudioFrame): PlayerSound {
  return {
    ...frame,
    x: (frame.x + 0.5) / frame.size,
    z: (frame.z + 0.5) / frame.size,
  };
}

export function editSound(
  before: World, after: World, cells: number[], derivation: WorldDerivation,
): EditSound | null {
  if (before === after) return null;
  const at = (world: World, i: number) => {
    const tile = world.terrain?.tiles[i];
    const objects = world.objects.filter((o) => o.x === i % world.size && o.z === Math.floor(i / world.size));
    return JSON.stringify([tile?.height, tile?.surface, tile ? isHole(tile) : false,
      objects.map((o) => [o.asset, o.rotation, o.scale])]);
  };
  const index = [...cells].reverse().find((i) => at(before, i) !== at(after, i));
  if (index === undefined) return null;
  const x = index % after.size, z = Math.floor(index / after.size);
  const added = after.objects.find((o) => o.x === x && o.z === z);
  const removed = before.objects.find((o) => o.x === x && o.z === z);
  const tile = after.terrain?.tiles[index];
  const cell = derivation.environment.cells[index];
  return {
    x: (x + 0.5) / after.size, z: (z + 0.5) / after.size,
    overlap: Math.min(1, Math.max(
      cell.grass, cell.water === null ? 0 : 1, cell.fog, 1 - cell.light,
      tile?.surface === "rough" ? 1 : 0,
      derivation.structures.some((s) => s.x === x && s.z === z) ? 1 : 0,
    )),
    asset: added?.asset ?? removed?.asset ?? "terrain",
    action: added && !removed ? "add" : removed && !added ? "remove" : "paint",
    surface: tile && isHole(tile) ? "hole" : tile?.surface ?? "plain",
  };
}
