import type { Tile, Surface } from "./terrain.ts";

export const MIN_HEIGHT = -1;
export const MAX_HEIGHT = 6;
export type TerrainTool = "surface" | "raise" | "lower" | "hole";

export function isHole(tile?: { height: number; hole?: boolean }) {
  return !!tile && (tile.hole ?? tile.height === -1);
}

export function editTile(tile: Tile, tool: TerrainTool, surface: Surface): Tile {
  const hole = isHole(tile);
  const height = hole && tile.hole === undefined ? 0 : tile.height;
  if (tool === "hole") return { ...tile, height, hole: !hole };
  if (tool === "surface") return { height, surface, hole: false };
  if (hole) return tile;
  return {
    ...tile,
    hole: false,
    height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height + (tool === "raise" ? 1 : -1))),
  };
}
