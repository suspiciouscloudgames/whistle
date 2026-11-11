"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clone, uid, type World } from "@/lib/world";
import { editTile, type TerrainTool } from "@/lib/tile";
import { flatTerrain, type Surface } from "@/lib/terrain";
import { createWorldDeriver, samePlacement } from "@/lib/world-derivation";
import { placementChanges, type PlacementFeedback } from "@/lib/placement-feedback";

type PaintOptions = {
  layer: "tiles" | "symbols";
  surface: Surface;
  terrainTool: TerrainTool;
  selectedAsset: string;
};

export function useWorldDocument(initialWorld: World, onChange: (world: World) => void) {
  const [world, setWorld] = useState(initialWorld);
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
    history.current.push(clone(worldRef.current));
    if (history.current.length > 40) history.current.shift();
    future.current = [];
    applyWorld(next);
  }, [applyWorld, revealChanges]);

  const edit = useCallback((change: (world: World) => void) => {
    const next = clone(worldRef.current);
    change(next);
    commit(next);
  }, [commit]);

  const load = useCallback((next: World, beforeUpgrade: World) => {
    history.current = next !== beforeUpgrade ? [clone(beforeUpgrade)] : [];
    if (history.current[0]?.terrain) history.current[0].terrain.generatorVersion = 2;
    future.current = [];
    applyWorld(next);
  }, [applyWorld]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return false;
    future.current.push(clone(worldRef.current));
    revealChanges(previous);
    applyWorld(previous);
    return true;
  }, [applyWorld, revealChanges]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return false;
    history.current.push(clone(worldRef.current));
    revealChanges(next);
    applyWorld(next);
    return true;
  }, [applyWorld, revealChanges]);

  const paint = useCallback((cells: number[], erase: boolean, options: PaintOptions) => {
    const { layer, surface, terrainTool, selectedAsset } = options;
    const first = !strokeBase.current;
    if (first) strokeBase.current = clone(worldRef.current);
    const next = clone(strokeBase.current!);
    if (layer === "tiles") {
      next.terrain ??= flatTerrain(next.size);
      for (const i of cells) {
        if (terrainTool === "hole" && i === next.start.z * next.size + next.start.x)
          continue;
        next.terrain.tiles[i] = editTile(next.terrain.tiles[i], terrainTool, surface);
      }
    } else {
      const asset = next.assets.find((a) => a.id === selectedAsset);
      if (!asset) return;
      for (const i of cells) {
        const x = i % next.size,
          z = Math.floor(i / next.size);
        if (erase)
          next.objects = next.objects.filter((o) => o.x !== x || o.z !== z);
        else if (
          next.objects.length < 250 &&
          !next.objects.some((o) => o.x === x && o.z === z) &&
          !(asset.solid && x === next.start.x && z === next.start.z)
        )
          next.objects.push({
            id: uid(), asset: asset.id, x, z,
            rotation: 0, scale: asset.defaultScale ?? 1,
          });
      }
    }
    if (samePlacement(worldRef.current, next)) {
      if (first) strokeBase.current = null;
      return;
    }
    if (first) commit(next);
    else {
      revealChanges(next);
      applyWorld(next);
    }
  }, [applyWorld, commit, revealChanges]);

  const endStroke = useCallback(() => { strokeBase.current = null; }, []);

  return {
    world, getWorld, deriveWorld, feedback,
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
    commit, edit, load, undo, redo, paint, endStroke,
  };
}
