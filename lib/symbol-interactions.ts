import type { Actor, Asset, Shape } from "./world.ts";

export type InteractionKind = "approach" | "touch" | "gaze" | "follow" | "wait" | "cross";
export const GAZE_SECONDS = 1.4;
export const WAIT_SECONDS = 3;
export function interactionKind(shape: Shape): InteractionKind {
  if (shape === "box" || shape === "tree") return "touch";
  if (shape === "cone" || shape === "flower") return "gaze";
  if (shape === "diamond" || shape === "stone") return "follow";
  if (shape === "ring") return "wait";
  if (shape === "bar" || shape === "arch") return "cross";
  return "approach";
}
export type SymbolState = {
  id: string;
  asset: string;
  kind: InteractionKind;
  anchorX: number;
  anchorZ: number;
  x: number;
  z: number;
  rotation: number;
  revealed: boolean;
  progress: number;
  opacity: number;
  expanded: boolean;
  touching: boolean;
  cooldown: number;
  leader: string;
  visited: string[];
  destination: string | null;
  arrived: boolean;
};
export type SymbolSense = {
  distance: number;
  visible: boolean;
  aimed: boolean;
  sameLevel: boolean;
};
export type SymbolPlayer = { x: number; z: number; feet: number; grounded: boolean };
export type SymbolSession = { states: Map<string, SymbolState>; previous: SymbolPlayer | null };
export function createSymbolSession(): SymbolSession {
  return { states: new Map(), previous: null };
}
export function syncSymbols(session: SymbolSession, actors: Actor[], assets: Asset[], origin = {x: 0, z: 0}) {
  const live = new Set<string>();
  const byAsset = new Map(assets.map(a => [a.id, a]));
  for (const actor of actors) {
    const asset = byAsset.get(actor.asset);
    if (actor.removed || !asset?.image) continue;
    live.add(actor.id);
    const kind = interactionKind(asset.shape), old = session.states.get(actor.id);
    if (old && old.asset === actor.asset && old.kind === kind && old.anchorX === actor.x && old.anchorZ === actor.z && old.rotation === actor.rotation) continue;
    session.states.set(actor.id, {
      id: actor.id, asset: actor.asset, kind, anchorX: actor.x, anchorZ: actor.z,
      x: actor.x, z: actor.z, rotation: actor.rotation, revealed: false,
      progress: 0, opacity: kind === "touch" || kind === "follow" ? 1 : 0,
      expanded: false, touching: false, cooldown: 0, leader: actor.id,
      visited: [actor.id], destination: null, arrived: false,
    });
  }
  for (const id of session.states.keys()) if (!live.has(id)) session.states.delete(id);
  const guides = new Map<string, SymbolState[]>();
  for (const state of session.states.values()) if (state.kind === "follow") {
    const group = guides.get(state.asset) ?? [];
    group.push(state);
    guides.set(state.asset, group);
  }
  for (const group of guides.values()) {
    const established = group.find(s => s.leader === s.id && (s.visited.length > 1 || s.destination));
    group.sort((a,b) => {
      if (a.id === established?.id) return -1;
      if (b.id === established?.id) return 1;
      return Math.hypot(a.anchorX-origin.x,a.anchorZ-origin.z) - Math.hypot(b.anchorX-origin.x,b.anchorZ-origin.z) || a.anchorZ-b.anchorZ || a.anchorX-b.anchorX || a.id.localeCompare(b.id);
    });
    for (const state of group) {
      if (state.leader !== group[0].id) {
        state.x = state.anchorX;
        state.z = state.anchorZ;
        state.destination = null;
        state.visited = [state.id];
      }
      state.leader = group[0].id;
      if (state.leader !== state.id) state.opacity = 0;
      if (state.destination && !live.has(state.destination)) state.destination = null;
    }
  }
}
export function crossesSymbol(
  previous: SymbolPlayer,
  player: SymbolPlayer,
  symbol: Pick<SymbolState, "anchorX" | "anchorZ" | "rotation">,
) {
  if (!previous.grounded || !player.grounded || Math.abs(player.feet - previous.feet) > .7) return false;
  const angle = symbol.rotation * Math.PI / 180;
  const nx = Math.sin(angle), nz = Math.cos(angle);
  const side = (p: SymbolPlayer) => (p.x - symbol.anchorX) * nx + (p.z - symbol.anchorZ) * nz;
  const a = side(previous), b = side(player);
  if (Math.abs(a) < 0.00001 || Math.abs(a - b) < 0.00001 || a * b > 0 || Math.hypot(player.x - previous.x, player.z - previous.z) > .5) return false;
  const t = a / (a - b);
  const x = previous.x + (player.x - previous.x) * t - symbol.anchorX;
  const z = previous.z + (player.z - previous.z) * t - symbol.anchorZ;
  return Math.abs(x * nz - z * nx) <= .65;
}
export function stepSymbols(
  session: SymbolSession,
  senses: Map<string, SymbolSense>,
  player: SymbolPlayer,
  elapsed: number,
  tapped: string | null = null,
) {
  const dt = Math.max(0, Math.min(.05, elapsed));
  const previous = session.previous;
  const speed = previous && dt > 0 ? Math.hypot(player.x - previous.x, player.z - previous.z) * 2 / dt : 0;
  for (const state of session.states.values()) {
    const sense = senses.get(state.id);
    if (!sense) continue;
    const nearby = sense.distance <= 3 && sense.visible && sense.sameLevel && player.grounded;
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.kind === "approach") {
      const t = Math.max(0, Math.min(1, (8 - sense.distance) / 5));
      state.progress = t * t * (3 - 2 * t);
    } else if (state.kind === "gaze" && !state.revealed) {
      state.progress = sense.visible && sense.aimed && sense.distance <= 12 && player.grounded
        ? Math.min(1, state.progress + dt / GAZE_SECONDS) : 0;
      if (state.progress >= 1) state.revealed = true;
    } else if (state.kind === "wait" && !state.revealed) {
      state.progress = nearby && speed < .18
        ? Math.min(1, state.progress + dt / WAIT_SECONDS) : 0;
      if (state.progress >= 1) state.revealed = true;
    } else if (state.kind === "touch") {
      const touching = nearby && sense.distance <= .9;
      if (state.cooldown === 0 && nearby && (tapped === state.id || (touching && !state.touching))) {
        state.expanded = !state.expanded;
        state.cooldown = .4;
      }
      state.touching = touching;
    } else if (state.kind === "cross" && previous && sense.sameLevel && crossesSymbol(previous, player, state)) {
      if (state.cooldown === 0) {
        state.revealed = !state.revealed;
        state.progress = state.revealed ? 1 : 0;
        const angle = state.rotation * Math.PI / 180;
        const nx = Math.sin(angle), nz = Math.cos(angle);
        const travel = Math.sign((player.x-previous.x)*nx + (player.z-previous.z)*nz);
        state.x = state.anchorX + (state.revealed ? nx*travel*.9 : 0);
        state.z = state.anchorZ + (state.revealed ? nz*travel*.9 : 0);
        state.cooldown = .5;
      }
    } else if (state.kind === "follow" && state.leader === state.id) {
      const target = state.destination ? session.states.get(state.destination) : undefined;
      if (target) {
        if (sense.distance <= 9) {
          const distance = Math.hypot(target.anchorX - state.x, target.anchorZ - state.z);
          const travel = Math.min(distance, dt * .85);
          if (distance > .001) {
            state.x += (target.anchorX - state.x) / distance * travel;
            state.z += (target.anchorZ - state.z) / distance * travel;
          }
          if (distance <= .04) {
            state.x = target.anchorX;
            state.z = target.anchorZ;
            state.visited.push(target.id);
            state.destination = null;
            state.arrived = true;
          }
        }
      } else if (nearby) {
        const candidates = [...session.states.values()]
          .filter(s => s.kind === "follow" && s.asset === state.asset && !state.visited.includes(s.id))
          .sort((a,b) => Math.hypot(a.anchorX-state.x,a.anchorZ-state.z) - Math.hypot(b.anchorX-state.x,b.anchorZ-state.z) || a.id.localeCompare(b.id));
        state.destination = candidates[0]?.id ?? null;
        state.progress = 1;
      } else state.progress = Math.max(0, state.progress - dt);
    }
    let opacity = state.kind === "approach" ? state.progress
      : state.kind === "touch" ? 1
      : state.kind === "follow" ? (state.leader === state.id ? 1 : 0)
      : state.revealed ? 1 : 0;
    state.opacity += (opacity - state.opacity) * (1 - Math.exp(-7 * dt));
  }
  session.previous = {...player};
}
