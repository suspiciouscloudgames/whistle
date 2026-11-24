import type { World } from "./world.ts";
import { bridgeAt, floatingCoverage, floorHeight, ladderAt, tileAt, type Structure } from "./terrain.ts";
import { groundTileHeight, isGap, isVoid } from "./tile.ts";

export function blocksVoidStep(world: Pick<World, "size" | "terrain">, from: { x: number; z: number }, to: { x: number; z: number }, structures: Structure[] = []) {
  if (!world.terrain?.floating) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .08));
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, z = from.z + (to.z - from.z) * i / steps;
    if (floatingCoverage(world, x, z) < .5 && !bridgeAt(structures, x, z)) return true;
    for (const dx of [-.08, .08]) for (const dz of [-.08, .08]) {
      const tile = tileAt(world, x + dx, z + dz);
      if ((!tile || isVoid(tile)) && !bridgeAt(structures, x + dx, z + dz)) return true;
    }
  }
  return false;
}

export function blocksTerrainStep(
  world: Pick<World, "size" | "terrain">,
  from: { x: number; z: number },
  to: { x: number; z: number },
  structures: Structure[] = [],
) {
  const cell = (value: number) => Math.max(0, Math.min(world.size - 1, Math.round(value)));
  const height = (x: number, z: number) => {
    const bridge = structures.find(s => s.kind === "bridge" && s.x === x && s.z === z);
    if (bridge) return bridge.height;
    const tile = world.terrain?.tiles[z * world.size + x];
    return isGap(tile) ? null : groundTileHeight(tile);
  };
  const steep = (ax: number, az: number, bx: number, bz: number) => {
    const a = height(ax, az), b = height(bx, bz);
    if (a === null || b === null || Math.abs(a-b) <= 1) return false;
    if (Math.abs(ax-bx)+Math.abs(az-bz) !== 1) return true;
    const t = ax !== bx ? ((ax+bx)/2-from.x)/(to.x-from.x) : ((az+bz)/2-from.z)/(to.z-from.z);
    const crossing = ladderAt(structures,from.x+(to.x-from.x)*t,from.z+(to.z-from.z)*t);
    return !crossing || !(
      (crossing.x === ax && crossing.z === az && crossing.x+crossing.dx === bx && crossing.z+crossing.dz === bz) ||
      (crossing.x === bx && crossing.z === bz && crossing.x+crossing.dx === ax && crossing.z+crossing.dz === az)
    );
  };
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 10));
  let x = cell(from.x), z = cell(from.z);
  for (let i = 1; i <= steps; i++) {
    const nx = cell(from.x + (to.x - from.x) * i / steps);
    const nz = cell(from.z + (to.z - from.z) * i / steps);
    if (steep(x, z, nx, nz) ||
        (x !== nx && z !== nz && (
          steep(x, z, nx, z) || steep(x, z, x, nz) ||
          steep(nx, z, nx, nz) || steep(x, nz, nx, nz)))) return true;
    x = nx;
    z = nz;
  }
  return false;
}

export function blocksWalkingStep(world: World, from: {x: number; z: number}, to: {x: number; z: number}, structures: Structure[]) {
  if (blocksVoidStep(world, from, to, structures)) return true;
  if (blocksTerrainStep(world,from,to,structures)) return true;
  const ladder = ladderAt(structures,from.x,from.z);
  if (ladder && ladderAt(structures,to.x,to.z) === ladder) return false;
  return blocksGroundStep(floorHeight(world,from.x,from.z,structures),floorHeight(world,to.x,to.z,structures),Math.hypot(to.x-from.x,to.z-from.z));
}


export function movementKey(event: {
  code: string;
  key: string;
}): string | null {
  const codes: Record<string, string> = {
    KeyW: "w",
    KeyA: "a",
    KeyS: "s",
    KeyD: "d",
    ArrowUp: "arrowup",
    ArrowDown: "arrowdown",
    ArrowLeft: "arrowleft",
    ArrowRight: "arrowright",
  };
  if (Object.hasOwn(codes, event.code)) return codes[event.code];
  if (event.code && event.code !== "Unidentified") return null;
  const key = event.key.toLowerCase();
  return Object.values(codes).includes(key) ? key : null;
}


export function followHeading(current: number, target: number, dt: number) {
  const difference = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  const elapsed = Math.max(0, dt);
  const eased = difference * (1 - Math.exp(-4 * elapsed));
  const limit = 0.6 * elapsed;
  return current + Math.max(-limit, Math.min(limit, eased));
}

export const FALL_SECONDS = 2.2;

export function fallFrame(originY: number, elapsed: number) {
  const t = Math.max(0, Math.min(FALL_SECONDS, elapsed));
  const fade = Math.max(0, Math.min(1, (t - 1.75) / 0.35));
  return {
    y: originY - 0.6 * t - 2.2 * t * t,
    fade,
    done: elapsed >= FALL_SECONDS,
  };
}


export function blocksGroundStep(
  current: number | null,
  next: number | null,
  distance: number,
) {
  return (
    current !== null &&
    next !== null &&
    Math.abs(next - current) > Math.max(0.23, distance * 5)
  );
}

export const JUMP_BUFFER_SECONDS = 0.16;
export const COYOTE_SECONDS = 0.12;

export function jumpFrame(origin: number, elapsed: number) {
  const t = Math.max(0, elapsed);
  return { y: origin + 4.8 * t - 5 * t * t, descending: t >= 0.48 };
}
export function movementProfile(running: boolean, crouching: boolean) {
  return crouching
    ? { speed: 0.45, eyeHeight: 0.82 }
    : { speed: running ? 1.65 : 1, eyeHeight: 1.35 };
}


export function blocksAirStep(feet: number, next: number | null) {
  return next !== null && next > feet + 0.23;
}


export function launchJump(origin: number, yaw: number, direction: number, speed: number) {
  const travel = direction === 0 ? 0 : Math.sign(direction) * Math.max(2.6, Math.abs(speed));
  return { origin, elapsed: 0, vx: Math.sin(yaw) * travel, vz: -Math.cos(yaw) * travel };
}
export function resolveJump(jump: { origin: number; elapsed: number }, floor: number | null) {
  const flight = jumpFrame(jump.origin, jump.elapsed);
  if (flight.descending && floor !== null && flight.y <= floor)
    return { feet: floor, landed: true, missed: false };
  const missed = floor === null && flight.descending && flight.y < jump.origin;
  return { feet: missed ? null : flight.y, landed: false, missed };
}


export function playerEyeHeight(feet: number, water: number | null, eyeHeight = 1.35) {
  return Math.max(feet + eyeHeight, water === null ? -Infinity : water + eyeHeight * 0.5);
}
