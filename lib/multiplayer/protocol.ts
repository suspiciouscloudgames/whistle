import { clone, type World } from "../world.ts";
import type { Surface } from "../terrain.ts";
import type { TerrainTool } from "../tile.ts";
import type { PlayerAudioFrame } from "../audio/game-parameters.ts";

export const ROOM_COLORS = ["#3378cc", "#d35472", "#279273", "#ac731b", "#8457c4", "#cb5d28", "#238c9c", "#876753"];
export const ROOM_PATH = "/whistle/room-socket";
export type Peer = { id: string; color: string; number: number; mode: "edit" | "play"; active: boolean; cursor: number | null; frame: PlayerAudioFrame | null };
export type Patch = { key: string; value: unknown };
export type Edit = Patch & { before: unknown };
export type Paint = { layer: "tiles" | "symbols"; surface: Surface; tool: TerrainTool; asset: string; erase: boolean; hole: boolean; cells: { index: number; objectId?: string }[] };
export type ClientMessage =
  | { type: "join"; room: string; world?: World }
  | { type: "presence"; mode: Peer["mode"]; active: boolean; cursor: number | null }
  | { type: "frame"; frame: PlayerAudioFrame; revision: number }
  | { type: "edit"; id: string; group: string; paint?: Paint; edits?: Edit[] }
  | { type: "undo" | "redo"; id: string };
export type ServerMessage =
  | { type: "welcome"; self: string; world: World; revision: number; peers: Peer[] }
  | { type: "peer"; peer: Peer }
  | { type: "left"; id: string }
  | { type: "world"; id: string; author: string; revision: number; patches: Patch[]; cells: number[]; sound: boolean; canUndo: boolean; canRedo: boolean; skipped: number }
  | { type: "error"; message: string };

export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Explicit paths only: no arbitrary property traversal from network messages.
export function fields(world: World): Map<string, unknown> {
  const result = new Map<string, unknown>();
  world.terrain?.tiles.forEach((tile, i) => {
    result.set(`height:${i}`, tile.height);
    result.set(`ground:${i}`, { surface: tile.surface, hole: tile.hole ?? tile.height === -1 });
  });
  for (const object of world.objects) result.set(`object:${object.id}`, object);
  for (const asset of world.assets) result.set(`asset:${asset.id}`, asset);
  result.set("weather", world.weather ?? "clear");
  result.set("start", world.start);
  return result;
}

export function diffWorld(before: World, after: World): Edit[] {
  if (!equal([before.size, before.terrain?.seed, before.terrain?.patterns], [after.size, after.terrain?.seed, after.terrain?.patterns]))
    throw Error("함께 만드는 동안에는 전체 지형을 교체할 수 없어요.");
  const a = fields(before), b = fields(after);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(key =>
    equal(a.get(key) ?? null, b.get(key) ?? null) ? [] : [{ key, before: a.get(key) ?? null, value: b.get(key) ?? null }]);
}

export function applyPatches(world: World, patches: Patch[]): World {
  const next = clone(world);
  for (const { key, value } of patches) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator), id = key.slice(separator + 1);
    if ((kind === "height" || kind === "ground") && /^(0|[1-9]\d*)$/.test(id)) {
      const tile = next.terrain?.tiles[Number(id)];
      if (!tile) throw Error("잘못된 칸입니다.");
      if (kind === "height") tile.height = value as number;
      else {
        const ground = value as { surface: Surface; hole: boolean };
        tile.surface = ground.surface;
        tile.hole = ground.hole;
      }
    } else if (kind === "object" && id) {
      next.objects = next.objects.filter(object => object.id !== id);
      if (value !== null) {
        const object = value as World["objects"][number];
        if (object.id !== id) throw Error("잘못된 기호입니다.");
        next.objects.push(object);
      }
    } else if (kind === "asset" && id) {
      const index = next.assets.findIndex(asset => asset.id === id);
      if (value !== null) {
        const asset = value as World["assets"][number];
        if (asset.id !== id) throw Error("잘못된 이미지입니다.");
        if (index < 0) next.assets.push(asset);
        else next.assets[index] = asset;
      } else if (index >= 0) next.assets.splice(index, 1);
    } else if (key === "weather") next.weather = value as World["weather"];
    else if (key === "start") next.start = value as World["start"];
    else throw Error("지원하지 않는 편집입니다.");
  }
  return next;
}
