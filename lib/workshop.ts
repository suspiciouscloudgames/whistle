import { uid, type Asset, type World } from "./world.ts";
import { contentKind, MAX_LIBRARY_SIZE, type ContentKind } from "./content-limits.ts";
import { isGap } from "./tile.ts";

export const WORKSHOP_MATERIAL_LIMIT = 6;
export const TURN_HINT = "배치는 내 차례에 할 수 있어요. 편집은 언제든 할 수 있어요.";
const kinds: ContentKind[] = ["text", "image", "sound"];
const names = { text: "텍스트", image: "이미지", sound: "사운드" };
const PREFERRED_SYMBOL_DISTANCE = 3;
const MIN_SYMBOL_DISTANCE = 2;

export function emptySymbol(asset?: Asset) {
  return !!asset?.prompt && !contentKind(asset);
}

function limitEmptySymbols(world: World) {
  const state = world.workshop;
  if (!state) return false;
  const empty = world.assets.filter(emptySymbol);
  const keep = empty.find(a => a.prompt?.title) ?? empty.find(a => world.objects.some(o => o.asset === a.id)) ?? empty[0];
  if (keep) {
    const removed = new Set(empty.filter(a => a.id !== keep.id).map(a => a.id));
    if (removed.size) {
      world.assets = world.assets.filter(a => !removed.has(a.id));
      world.objects = world.objects.filter(o => !removed.has(o.asset));
      world.rules = world.rules.filter(r => ![r.subject, r.source, r.replacement].some(id => removed.has(id)));
    }
    state.next = (kinds.indexOf(keep.prompt!.kind) + 1) % kinds.length;
    if (!world.objects.some(o => o.asset === keep.id)) {
      state.pending = [{ ...keep.prompt!, x: Math.max(0, world.start.x - 1), z: Math.max(0, world.start.z - 1) }];
      return false;
    }
    state.pending = [];
    return true;
  }
  state.pending.splice(1);
  return false;
}

export function refillSymbols(world: World) {
  const state = world.workshop;
  if (!state || limitEmptySymbols(world)) return;
  const authored = world.assets.filter(a => !a.received && (contentKind(a) || emptySymbol(a))).length;
  const waiting = world.assets.find(emptySymbol);
  const pending = state.pending[0];
  if (!pending || (!waiting && (authored >= WORKSHOP_MATERIAL_LIMIT || world.assets.length >= MAX_LIBRARY_SIZE)) || world.objects.length >= 250) return;
  const distanceSquared = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  const floors = Array.from({ length: world.size ** 2 }, (_, i) => ({ x: i % world.size, z: Math.floor(i / world.size) }))
    .filter(p => world.terrain?.tiles[p.z * world.size + p.x] && !isGap(world.terrain.tiles[p.z * world.size + p.x]) &&
      !(p.x === world.start.x && p.z === world.start.z))
    .sort((a, b) => distanceSquared(a, pending) - distanceSquared(b, pending) || a.z - b.z || a.x - b.x);
  const findFloor = (distance: number) => floors.find(p => world.objects.every(o => distanceSquared(p, o) >= distance ** 2));
  const nearest = findFloor(PREFERRED_SYMBOL_DISTANCE) ?? findFloor(MIN_SYMBOL_DISTANCE);
  if (!nearest) return;
  let id = waiting?.id;
  if (!id) {
    do { id = `workshop-${state.id}-${++state.serial}`; } while (world.assets.some(a => a.id === id) || world.objects.some(o => o.id === `${id}-site`));
    world.assets.push({ id, name: pending.title ? "장면 제목" : names[pending.kind], shape: pending.kind === "text" ? "cone" : "sphere",
      color: "#777777", solid: false, prompt: { kind: pending.kind, ...(pending.title ? { title: true } : {}) } });
  }
  const { x, z } = nearest;
  const siteId = world.objects.some(o => o.id === `${id}-site`) ? uid() : `${id}-site`;
  world.objects.push({ id: siteId, asset: id, x, z, rotation: 0, scale: 1 });
  state.pending = [];
  state.next = (kinds.indexOf(pending.kind) + 1) % kinds.length;
}

export function initializeWorkshop(world: World) {
  if (!world.workshop) {
    world.workshop = { id: uid(), serial: 0, next: 0, pending: [{ kind: "text", title: true,
      x: Math.max(0, world.start.x - 1), z: Math.max(0, world.start.z - 1) }] };
  }
  refillSymbols(world);
  return world;
}

export function completeSymbol(world: World, previous: Asset, objectId?: string) {
  const current = world.assets.find(a => a.id === previous.id);
  if (previous.prompt?.title && current?.text?.trim()) world.title = current.text.trim().slice(0, 60);
  if (!world.workshop || !emptySymbol(previous) || !contentKind(current)) return;
  const place = world.objects.find(o => o.id === objectId && o.asset === previous.id) ?? world.objects.find(o => o.asset === previous.id);
  const point = place ?? world.start;
  const kind = kinds[(kinds.indexOf(previous.prompt!.kind) + 1) % kinds.length];
  world.workshop.pending = [{ kind, x: point.x, z: point.z }];
  refillSymbols(world);
}

// Rebuild permitted automatic additions rather than trusting positions supplied off-turn.
export function isContentEdit(before: World, after: World) {
  if (JSON.stringify([before.size, before.start, before.terrain]) !==
      JSON.stringify([after.size, after.start, after.terrain])) return false;
  const expected: World = { ...before, assets: [...before.assets], objects: [...before.objects],
    ...(before.workshop ? { workshop: structuredClone(before.workshop) } : {}) };
  limitEmptySymbols(expected);
  const originalAssets = expected.assets;
  expected.assets = after.assets.filter(a => originalAssets.some(b => b.id === a.id) || a.received).map(a => ({ ...a }));
  if (originalAssets.some(a => !expected.assets.some(b => b.id === a.id))) return false;
  for (let i = 0; i < expected.assets.length; i++) {
    const asset = originalAssets.find(a => a.id === expected.assets[i].id) ?? expected.assets[i];
    const next = after.assets.find(a => a.id === asset.id);
    if (!next) return false;
    if (JSON.stringify(asset.prompt) !== JSON.stringify(next.prompt) || !!asset.received !== !!next.received) return false;
    if (emptySymbol(asset) && contentKind(next) && contentKind(next) !== asset.prompt!.kind) return false;
    expected.assets[i] = { ...next };
    completeSymbol(expected, asset);
  }
  refillSymbols(expected);
  const layout = (w: World) => w.objects.map(o => [o.id, o.asset, o.x, o.z, o.rotation]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (JSON.stringify(layout(expected)) !== JSON.stringify(layout(after)) || JSON.stringify(expected.rules) !== JSON.stringify(after.rules) ||
      JSON.stringify(expected.workshop) !== JSON.stringify(after.workshop)) return false;
  return after.assets.every(a => expected.assets.some(e => e.id === a.id &&
    (before.assets.some(b => b.id === a.id) || a.received || JSON.stringify(a) === JSON.stringify(e))));
}
