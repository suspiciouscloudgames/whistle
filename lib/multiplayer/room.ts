import { clone, validateWorld, type World } from "../world.ts";
import { isHole, MAX_HEIGHT, MIN_HEIGHT } from "../tile.ts";
import { applyPatches, diffWorld, equal, fields, type Edit, type Paint, type Patch } from "./protocol.ts";

type Change = Edit & { head: string | null; previous: string | null };
type Group = { id: string; changes: Change[] };
type History = { undo: Group[]; redo: Group[] };
type Result = { patches: Patch[]; cells: number[]; skipped: number };

function checked(world: World) {
  validateWorld(world);
  const occupied = new Set<string>();
  for (const object of world.objects) {
    const key = `${object.x},${object.z}`;
    if (occupied.has(key)) throw Error("이미 기호가 있는 칸입니다.");
    occupied.add(key);
    if (object.x === world.start.x && object.z === world.start.z && world.assets.find(a => a.id === object.asset)?.solid)
      throw Error("시작점이 막혀 있습니다.");
  }
  if (JSON.stringify(world).length > 6_000_000) throw Error("세계 데이터가 너무 커요.");
  return world;
}

export class RoomDocument {
  world: World;
  revision = 0;
  private heads = new Map<string, string | null>();
  private histories = new Map<string, History>();
  private seen = new Set<string>();
  private strokes = new Map<string, Set<number>>();
  constructor(world: World) { this.world = checked(clone(world)); }
  history(user: string) {
    let history = this.histories.get(user);
    if (!history) { history = { undo: [], redo: [] }; this.histories.set(user, history); }
    return history;
  }
  forget(user: string) { this.histories.delete(user); }
  private changedCells(before: World, after: World) {
    const cells = new Set<number>();
    before.terrain?.tiles.forEach((tile, i) => { if (!equal(tile, after.terrain?.tiles[i])) cells.add(i); });
    for (const object of [...before.objects, ...after.objects]) {
      if (!equal(before.objects.find(o => o.id === object.id), after.objects.find(o => o.id === object.id))) cells.add(object.z * after.size + object.x);
    }
    return [...cells];
  }
  private remember(id: string) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 10_000) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  edit(user: string, operation: string, group: string, edits?: Edit[], paint?: Paint): Result {
    if (!this.remember(`${user}:${operation}`)) return { patches: [], cells: [], skipped: 0 };
    const before = this.world;
    const proposed: Edit[] = [];
    let skipped = 0;
    if (paint) {
      if (!Array.isArray(paint.cells) || paint.cells.length > 576 || !["tiles", "symbols"].includes(paint.layer) ||
          !["plain", "rough", "slick", "soft"].includes(paint.surface) || !["surface", "hole", "raise", "lower"].includes(paint.tool)) throw Error("잘못된 칠하기입니다.");
      const strokeKey = `${user}:${group}`;
      let visited = this.strokes.get(strokeKey);
      if (!visited) { visited = new Set(); this.strokes.set(strokeKey, visited); }
      if (this.strokes.size > 512) this.strokes.delete(this.strokes.keys().next().value!);
      const draft = clone(before);
      for (const cell of paint.cells) {
        const i = cell.index;
        if (!Number.isInteger(i) || i < 0 || i >= before.size ** 2 || visited.has(i)) continue;
        visited.add(i);
        const x = i % before.size, z = Math.floor(i / before.size);
        if (paint.layer === "tiles") {
          const tile = draft.terrain?.tiles[i];
          if (!tile) continue;
          if (paint.tool === "hole") {
            if (x === before.start.x && z === before.start.z && paint.hole) { skipped++; continue; }
            tile.hole = !!paint.hole;
          } else if (paint.tool === "surface") { tile.surface = paint.surface; tile.hole = false; }
          else if (!isHole(tile)) tile.height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, tile.height + (paint.tool === "raise" ? 1 : -1)));
        } else {
          const existing = draft.objects.find(o => o.x === x && o.z === z);
          if (paint.erase) {
            if (existing && existing.id === cell.objectId) draft.objects = draft.objects.filter(o => o.id !== existing.id);
            else if (existing) skipped++;
          } else {
            const asset = draft.assets.find(a => a.id === paint.asset);
            if (!asset || existing || draft.objects.length >= 250 || (asset.solid && x === draft.start.x && z === draft.start.z)) { skipped++; continue; }
            draft.objects.push({ id: crypto.randomUUID(), asset: asset.id, x, z, rotation: 0, scale: asset.defaultScale ?? 1 });
          }
        }
      }
      proposed.push(...diffWorld(before, draft));
    } else {
      if (!Array.isArray(edits) || edits.length > 1200) throw Error("잘못된 편집입니다.");
      const current = fields(before);
      for (const edit of edits) {
        if (!edit || typeof edit.key !== "string") throw Error("잘못된 편집입니다.");
        if (!equal(current.get(edit.key) ?? null, edit.before)) { skipped++; continue; }
        proposed.push(edit);
      }
    }
    const unique = new Map(proposed.map(edit => [edit.key, edit]));
    const accepted = [...unique.values()].filter(edit => !equal(edit.before, edit.value));
    if (!accepted.length) return { patches: [], cells: [], skipped };
    const next = checked(applyPatches(before, accepted));
    const history = this.history(user);
    let entry = history.undo.at(-1);
    if (entry?.id !== group) {
      entry = { id: group, changes: [] }; history.undo.push(entry);
      if (history.undo.length > 40) history.undo.shift();
    }
    for (const edit of accepted) {
      const head = crypto.randomUUID(), previous = this.heads.get(edit.key) ?? null;
      entry.changes.push({ ...edit, head, previous });
      this.heads.set(edit.key, head);
    }
    history.redo = [];
    this.world = next;
    this.revision++;
    return { patches: accepted.map(({ key, value }) => ({ key, value })), cells: this.changedCells(before, next), skipped };
  }
  revert(user: string, operation: string, redo: boolean): Result {
    if (!this.remember(`${user}:${operation}`)) return { patches: [], cells: [], skipped: 0 };
    const history = this.history(user);
    const source = redo ? history.redo : history.undo, destination = redo ? history.undo : history.redo;
    const group = source.pop();
    if (!group) return { patches: [], cells: [], skipped: 0 };
    const before = this.world, inverse: Group = { id: group.id, changes: [] };
    const patches: Patch[] = [];
    let skipped = 0;
    for (const change of [...group.changes].reverse()) {
      if ((this.heads.get(change.key) ?? null) !== change.head || !equal(fields(this.world).get(change.key) ?? null, change.value)) { skipped++; continue; }
      try {
        const patch = { key: change.key, value: change.before };
        this.world = checked(applyPatches(this.world, [patch]));
        this.heads.set(change.key, change.previous);
        patches.push(patch);
        inverse.changes.push({ key: change.key, before: change.value, value: change.before, head: change.previous, previous: change.head });
      } catch { skipped++; }
    }
    if (inverse.changes.length) { destination.push(inverse); this.revision++; }
    return { patches, cells: this.changedCells(before, this.world), skipped };
  }
}
