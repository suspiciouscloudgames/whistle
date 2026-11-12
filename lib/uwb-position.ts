import type { World } from "./world.ts";
import type { WorldDerivation } from "./world-derivation.ts";
import { environmentAt } from "./environment.ts";
import { floorHeight, terrainSample } from "./terrain.ts";
import { playerSound, type PlayerAudioFrame } from "./audio/game-parameters.ts";

export type Position2D = { x: number; z: number };
export type RoomMapping = {
  originX: number; originZ: number;
  width: number; depth: number; rotation: number;
};

export function mapRoomPosition(position: Position2D, mapping: RoomMapping, size: number) {
  if (![position.x, position.z, mapping.originX, mapping.originZ,
    mapping.width, mapping.depth, mapping.rotation, size].every(Number.isFinite)
    || mapping.width <= 0 || mapping.depth <= 0 || !Number.isInteger(size) || size < 1) {
    throw new Error("좌표는 유한한 숫자, 공간 가로·세로는 0보다 큰 값이어야 합니다.");
  }
  const angle = mapping.rotation * Math.PI / 180;
  const dx = position.x - mapping.originX, dz = position.z - mapping.originZ;
  const u = (dx * Math.cos(angle) + dz * Math.sin(angle)) / mapping.width;
  const v = (-dx * Math.sin(angle) + dz * Math.cos(angle)) / mapping.depth;
  if (![u, v].every(Number.isFinite)) throw new Error("좌표 변환 범위를 초과했습니다.");
  if (u < -1e-9 || v < -1e-9 || u > 1 + 1e-9 || v > 1 + 1e-9) return null;
  return { x: Math.max(0, Math.min(1, u)) * size - 0.5,
    z: Math.max(0, Math.min(1, v)) * size - 0.5 };
}

export function roomPositionAt(u: number, v: number, mapping: RoomMapping): Position2D {
  const angle = mapping.rotation * Math.PI / 180;
  return {
    x: mapping.originX + u * mapping.width * Math.cos(angle) - v * mapping.depth * Math.sin(angle),
    z: mapping.originZ + u * mapping.width * Math.sin(angle) + v * mapping.depth * Math.cos(angle),
  };
}

export function sampleTrackedPosition(world: World, derivation: WorldDerivation,
  position: Position2D, mapping: RoomMapping) {
  const grid = mapRoomPosition(position, mapping, world.size);
  if (!grid) return { status: "outside" as const, grid: null, frame: null, sound: null };
  const ground = floorHeight(world, grid.x, grid.z, derivation.structures);
  if (ground === null) return { status: "no-ground" as const, grid, frame: null, sound: null };
  const local = environmentAt(derivation.environment, grid.x, grid.z);
  const dry = local.water === null || ground >= local.water;
  const frame: PlayerAudioFrame = {
    ...grid, y: ground, size: world.size, grass: local.grass,
    rough: dry ? terrainSample(world, grid.x, grid.z).weights.rough : 0,
    water: dry ? 0 : 1, grounded: true, falling: false, yaw: 0,
  };
  return { status: "tracking" as const, grid, frame, sound: playerSound(frame) };
}
