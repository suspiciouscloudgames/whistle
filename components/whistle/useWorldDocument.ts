"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clone, uid, type Asset, type ConnectionFooting, type World } from "@/lib/world";
import { editTile, MIN_HEIGHT, MAX_HEIGHT, type TerrainTool } from "@/lib/tile";
import { flatTerrain, floorHeight, LEVEL, type Surface } from "@/lib/terrain";
import { WATER_INSET } from "@/lib/water";
import { createWorldDeriver, samePlacement } from "@/lib/world-derivation";
import { placementChanges, type PlacementFeedback } from "@/lib/placement-feedback";
import { withSymbolColors } from "@/lib/symbol-color";
import { contentKind, MAX_CONTENT_COUNT, mergeReceivedAssets } from "@/lib/content-limits";
import { refillSymbols } from "@/lib/workshop";
import { TURN_TILE_LIMIT, type TurnTiles } from "@/lib/turn-tiles";

function copyDocument(world: World): World {
  return { ...clone({ ...world, assets: [] }), assets: world.assets.map(asset => ({
    ...asset, ...(asset.sound ? { sound: { ...asset.sound } } : {}),
  })) };
}

type PaintOptions = {
  layer: "tiles" | "symbols";
  assetId?: string;
  surface: Surface;
  terrainTool: TerrainTool;
  turnTiles?: TurnTiles;
};

export function useWorldDocument(initialWorld: World, onChange: (world: World) => void) {
  const [world, setWorld] = useState(() => withSymbolColors(initialWorld));
  const worldRef = useRef(world);
  const history = useRef<World[]>([]);
  const future = useRef<World[]>([]);
  const strokeBase = useRef<World | null>(null);
  const deriveWorld = useMemo(createWorldDeriver, []);
  const [feedback, setFeedback] = useState<PlacementFeedback | null>(null);
  const feedbackId = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const getWorld = useCallback(() => worldRef.current, []);
  const applyWorld = useCallback((next: World) => {
    next = withSymbolColors(next);
    setWorld(next);
    worldRef.current = next;
    onChange(next);
  }, [onChange]);
  const revealChanges = useCallback((next: World) => {
    const before = worldRef.current;
    const cells = placementChanges(before, next, deriveWorld(before), deriveWorld(next));
    if (!cells.length) return;
    setFeedback({ id: ++feedbackId.current, cells });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400);
  }, [deriveWorld]);

  const commit = useCallback((next: World) => {
    revealChanges(next);
    history.current.push(copyDocument(worldRef.current));
    if (history.current.length > 40) history.current.shift();
    future.current = [];
    applyWorld(next);
  }, [applyWorld, revealChanges]);

  const edit = useCallback((change: (world: World) => void) => {
    const next = copyDocument(worldRef.current);
    change(next);
    commit(next);
  }, [commit]);

  const load = useCallback((next: World, beforeUpgrade: World) => {
    strokeBase.current = null;
    setFeedback(null);
    history.current = next !== beforeUpgrade ? [copyDocument(beforeUpgrade)] : [];
    if (history.current[0]?.terrain) history.current[0].terrain.generatorVersion = 2;
    future.current = [];
    applyWorld(next);
  }, [applyWorld]);

  const undo = useCallback((allow?: (next: World) => boolean) => {
    const previous = history.current.at(-1);
    if (!previous || (allow && !allow(previous))) return false;
    history.current.pop();
    future.current.push(copyDocument(worldRef.current));
    revealChanges(previous);
    applyWorld(previous);
    return true;
  }, [applyWorld, revealChanges]);

  const redo = useCallback((allow?: (next: World) => boolean) => {
    const next = future.current.at(-1);
    if (!next || (allow && !allow(next))) return false;
    future.current.pop();
    history.current.push(copyDocument(worldRef.current));
    revealChanges(next);
    applyWorld(next);
    return true;
  }, [applyWorld, revealChanges]);

  const paint = useCallback((cells: number[], erase: boolean, options: PaintOptions, allow?: (next: World) => boolean) => {
    const { layer, assetId, surface, terrainTool, turnTiles } = options;
    if (layer === "symbols" && !worldRef.current.assets.some(asset => asset.id === assetId)) return;
    const first = !strokeBase.current;
    if (first) strokeBase.current = copyDocument(worldRef.current);
    const next = copyDocument(strokeBase.current!);
    let limited = false;
    if (layer === "tiles") {
      next.terrain ??= flatTerrain(next.size);
      const waterEdits = new Set<number>();
      if (terrainTool === "raise" || terrainTool === "lower") {
        for (const pond of deriveWorld(strokeBase.current!).environment.ponds) {
          if (!pond.cells.some(i => cells.includes(i))) continue;
          const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT,
            Math.round((pond.level + WATER_INSET) / LEVEL) + (terrainTool === "raise" ? 1 : -1)));
          for (const i of pond.cells) {
            waterEdits.add(i);
            if (next.terrain.tiles[i].surface === "slick") next.terrain.tiles[i] = { ...next.terrain.tiles[i], height, hole: false };
          }
        }
      }
      const counted = turnTiles && new Set([...turnTiles.existing, ...turnTiles.added]);
      let remaining = TURN_TILE_LIMIT - (turnTiles?.added.length ?? 0);
      for (const i of cells) {
        if (waterEdits.has(i)) continue;
        if ((terrainTool === "hole" || terrainTool === "erase") && i === next.start.z * next.size + next.start.x)
          continue;
        if (terrainTool === "erase") next.terrain.floating = true;
        if (counted && terrainTool === "surface" && next.terrain.tiles[i].void && !counted.has(i)) {
          if (remaining === 0) { limited = true; continue; }
          remaining--;
          counted.add(i);
        }
        next.terrain.tiles[i] = editTile(next.terrain.tiles[i], terrainTool, surface);
      }
    }
    if (layer === "symbols") {
      const asset = next.assets.find(asset => asset.id === assetId)!;
      const structures = deriveWorld(strokeBase.current!).structures;
      for (const i of cells) {
        const x = i % next.size, z = Math.floor(i / next.size);
        if (erase) next.objects = next.objects.filter(object => object.x !== x || object.z !== z || object.asset !== asset.id);
        else if (floorHeight(next,x,z,structures)!==null && (!contentKind(asset) || next.objects.filter(object => contentKind(next.assets.find(a => a.id === object.asset)) === contentKind(asset)).length < MAX_CONTENT_COUNT) &&
          !next.objects.some(object => object.x === x && object.z === z && object.asset === asset.id))
          next.objects.push({ id: uid(), asset: asset.id, x, z, rotation: 0, scale: asset.defaultScale ?? 1 });
      }
    }
    refillSymbols(next);
    if (samePlacement(worldRef.current, next) || (allow && !allow(next))) {
      if (first) strokeBase.current = null;
      return limited;
    }
    if (first) commit(next);
    else {
      revealChanges(next);
      applyWorld(next);
    }
    return limited;
  }, [applyWorld, commit, revealChanges]);

  const endStroke = useCallback(() => { strokeBase.current = null; }, []);

  const moveSymbol = useCallback((id: string, index: number) => {
    const current = worldRef.current, object = current.objects.find(o => o.id === id);
    const x = index % current.size, z = Math.floor(index / current.size);
    if (!object || index < 0 || index >= current.size ** 2 || object.x === x && object.z === z ||
        current.objects.some(o => o.id !== id && o.x === x && o.z === z) ||
        floorHeight(current, x, z, deriveWorld(current).structures) === null) return false;
    edit(w => { const next = w.objects.find(o => o.id === id)!; next.x = x; next.z = z; delete next.site; refillSymbols(w); });
    return true;
  }, [deriveWorld, edit]);

  const receiveAssets = useCallback((assets: Asset[]) => {
    const result = mergeReceivedAssets(worldRef.current,assets);
    if (!result.accepted.length) return [];
    const merge = (w:World) => {
      const next = mergeReceivedAssets(w,result.accepted);
      return next.accepted.length === result.accepted.length ? [next.world] : [];
    };
    history.current = history.current.flatMap(merge);
    future.current = future.current.flatMap(merge);
    if (strokeBase.current) strokeBase.current = merge(strokeBase.current)[0] ?? null;
    applyWorld(result.world);
    return result.accepted;
  }, [applyWorld]);

  const syncConnectionFootings = useCallback((footings: ConnectionFooting[] = []) => {
    if (JSON.stringify(worldRef.current.connectionFootings ?? []) === JSON.stringify(footings)) return;
    const sync = (w: World): World => ({ ...w, connectionFootings: footings.map(p => ({ ...p })) });
    history.current = history.current.map(sync);
    future.current = future.current.map(sync);
    if (strokeBase.current) strokeBase.current = sync(strokeBase.current);
    applyWorld(sync(worldRef.current));
  }, [applyWorld]);

  return {
    world, getWorld, deriveWorld, feedback,
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
    commit, edit, load, undo, redo, paint, endStroke, moveSymbol, receiveAssets, syncConnectionFootings,
  };
}
