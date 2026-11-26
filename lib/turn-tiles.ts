import type { World } from "./world.ts";

export const TURN_TILE_LIMIT = 3;
export const TURN_TILE_HINT = "새 타일은 한 차례에 3칸까지 놓을 수 있어요.";

export type TurnTiles = { existing: number[]; added: number[] };

function floorCells(world: World) {
  return Array.from({ length: world.size ** 2 }, (_, i) => i)
    .filter(i => !world.terrain?.tiles[i]?.void);
}

export function startTurnTiles(world: World): TurnTiles {
  return { existing: floorCells(world), added: [] };
}

export function uncountedTiles(world: World, budget: TurnTiles) {
  const counted = new Set([...budget.existing, ...budget.added]);
  return floorCells(world).filter(i => !counted.has(i));
}
