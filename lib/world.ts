import { validateContentCounts, MAX_CONTENT_COUNT, MAX_LIBRARY_SIZE } from "./content-limits.ts";
import { isGap, MIN_HEIGHT, MAX_HEIGHT } from "./tile.ts";
import { validRecording, type Recording } from "./audio/recording.ts";
import {
  deriveStructures,
  floorHeight,
  type Terrain,
  type Structure,
} from "./terrain.ts";
export const MAX_TEXT_LENGTH = 10_000;
export type Shape =
  | "cone"
  | "ring"
  | "bar"
  | "diamond"
  | "tree"
  | "flower"
  | "arch"
  | "bell"
  | "stone"
  | "box"
  | "sphere"
  | "image";
export type Asset = {
  id: string;
  name: string;

  shape: Shape;
  color: string;
  glyphColor?: string;
  received?: boolean;
  prompt?: { kind: "image" | "text" | "sound"; title?: boolean; reward?: true };
  image?: string;
  originalImage?: string;
  sound?: Recording;

  text?: string;
  textColor?: string;
  display?: "steady" | "nearby" | "pulse";
  defaultScale?: number;
  placement?: "upright" | "floating" | "surface" | "field";
  motion?: "still" | "wind";
  solid: boolean;
};
export type SymbolSiteKind = "cluster" | "peak" | "boundary";
export type Placed = {
  site?: { kind: SymbolSiteKind; cells: number[]; height: number };
  id: string;
  asset: string;
  x: number;
  z: number;
  rotation: number;
  scale: number;
};
export type Trigger = "gaze" | "approach" | "marked" | "neighbor";
export type Action = "mark" | "sound" | "disappear" | "change" | "move";
export type Rule = {
  id: string;
  subject: string;
  trigger: Trigger;
  token: string;
  source: string;
  radius: number;
  action: Action;
  result: string;
  replacement: string;
  enabled: boolean;
};
export type Weather = "clear" | "cloud" | "rain" | "snow";
export type TimeOfDay = "auto" | "noon" | "midnight";
export type ConnectionFooting = { id: string; side: 0 | 1; row: number; built: boolean; created: number };
export type World = {
  version: 1;
  title: string;
  description: string;
  size: number;
  assets: Asset[];
  receivedMaterialIds?: string[];
  connectionFootings?: ConnectionFooting[];
  objects: Placed[];
  rules: Rule[];
  start: { x: number; z: number };
  sky: string;
  weather?: Weather;
  timeOfDay?: TimeOfDay;
  terrain?: Terrain;
  workshop?: {
    id: string;
    serial: number;
    next: number;
    lastGate?: string;
    growth?: { seen: number[]; islands: number[][]; remainder: number; pending: number[] };
    pending: { kind: "image" | "text" | "sound"; x: number; z: number; title?: boolean }[];
  };
};
export type Actor = Placed & { marks: string[]; removed: boolean };
export type Event = {
  ruleId: string;
  objectId: string;
  asset: string;
  action: Action;
  message: string;
  x: number;
  z: number;
};
export type Simulation = {
  actors: Actor[];
  matched: Set<string>;
  tick: number;
  events: Event[];
};
export type Player = {
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
  falling?: boolean;
  grounded?: boolean;
};
export const PALETTE = ["#111111", "#555555", "#999999", "#dddddd"];
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function starterWorld(): World {
  const assets: Asset[] = [
    {
      id: "circle",
      name: "원",
      shape: "sphere",
      color: "#111111",
      solid: false,
    },
    {
      id: "square",
      name: "사각형",
      shape: "box",
      color: "#111111",
      solid: false,
    },
    {
      id: "triangle",
      name: "삼각형",
      shape: "cone",
      color: "#111111",
      solid: false,
    },
    {
      id: "diamond",
      name: "마름모",
      shape: "diamond",
      color: "#111111",
      solid: false,
    },
    { id: "ring", name: "고리", shape: "ring", color: "#111111", solid: false },
    { id: "bar", name: "선", shape: "bar", color: "#111111", solid: false },
  ];
  const p = (asset: string, x: number, z: number): Placed => ({
    id: asset + "-" + x + "-" + z,
    asset,
    x,
    z,
    rotation: 0,
    scale: 1,
  });
  return {
    version: 1,
    title: "무제",
    description: "",
    size: 12,
    sky: "#ffffff",
    assets,
    objects: [
      p("circle", 4, 4),
      p("square", 7, 4),
      p("triangle", 6, 7),
      p("ring", 3, 8),
      p("diamond", 8, 8),
    ],
    rules: [],
    start: { x: 6, z: 10 },
  };
}

export function abstractWorld(original: World): World {
  const w = clone(original);
  const shapes: Partial<Record<Shape, Shape>> = {
    bell: "sphere",
    flower: "cone",
    tree: "box",
    arch: "bar",
    stone: "diamond",
  };
  const names: Partial<Record<Shape, string>> = {
    bell: "원",
    flower: "삼각형",
    tree: "사각형",
    arch: "선",
    stone: "마름모",
  };
  const stockNames: Record<string, string> = {
    cup: "작은 종",
    flower: "잠든 꽃",
    tree: "둥근 나무",
    gate: "비밀의 문",
    rock: "조약돌",
    orb: "분홍 구슬",
  };
  w.assets = w.assets.map((a) => {
    const stock = stockNames[a.id] === a.name;
    return {
      ...a,
      shape: shapes[a.shape] ?? a.shape,
      name: stock ? (names[a.shape] ?? "원") : a.name,
      solid: stock ? false : a.solid,
      color: "#111111",
    };
  });
  if (w.title === "잠든 정원") {
    w.title = "무제";
    w.description = "";
  }
  w.sky = "#ffffff";
  const oldRules: Record<string, Partial<Rule>> = {
    r1: {
      subject: "cup",
      trigger: "gaze",
      token: "별",
      source: "*",
      radius: 4,
      action: "mark",
      result: "별",
    },
    r2: {
      subject: "flower",
      trigger: "neighbor",
      token: "별",
      source: "*",
      radius: 2.2,
      action: "mark",
      result: "별",
    },
    r3: {
      subject: "flower",
      trigger: "marked",
      token: "별",
      source: "*",
      radius: 2.2,
      action: "sound",
      result: "",
    },
    r4: {
      subject: "gate",
      trigger: "neighbor",
      token: "별",
      source: "flower",
      radius: 2.2,
      action: "disappear",
      result: "",
    },
  };
  w.rules = w.rules.filter(
    (r) =>
      !oldRules[r.id] ||
      !Object.entries(oldRules[r.id]).every(
        ([key, value]) => r[key as keyof Rule] === value,
      ),
  );
  return w;
}
export function createSimulation(world: World): Simulation {
  return {
    actors: world.objects.map((o) => ({ ...o, marks: [], removed: false })),
    matched: new Set(),
    tick: 0,
    events: [],
  };
}
function distance(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function lineOfSight(
  world: World,
  actors: Actor[],
  player: Player,
  target: Actor,
  structures: Structure[] = deriveStructures(world, actors),
) {
  const dx = target.x - player.x,
    dz = target.z - player.z,
    l = dx * dx + dz * dz;
  if (l === 0) return true;
  const eye = (floorHeight(world, player.x, player.z, structures) ?? 0) + 1.55;
  const center =
    (floorHeight(world, target.x, target.z, structures) ?? 0) +
    0.8 * target.scale;
  const samples = Math.ceil(Math.sqrt(l) * 8);
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    if (
      (floorHeight(world, player.x + dx * t, player.z + dz * t, structures) ??
        -1) >
      eye + (center - eye) * t
    )
      return false;
  }
  return !actors.some((a) => {
    if (
      a.id === target.id ||
      a.removed ||
      !world.assets.find((s) => s.id === a.asset)?.solid
    )
      return false;
    const t = ((a.x - player.x) * dx + (a.z - player.z) * dz) / l;
    const ground = floorHeight(world, a.x, a.z, structures) ?? 0;
    const rayY = eye + (center - eye) * t;
    return (
      t > 0.03 &&
      t < 0.97 &&
      rayY >= ground &&
      rayY <= ground + 1.6 * a.scale &&
      Math.hypot(a.x - (player.x + t * dx), a.z - (player.z + t * dz)) <
        0.37 * a.scale
    );
  });
}
export function stepSimulation(
  world: World,
  previous: Simulation,
  player?: Player,
): Simulation {
  const snapshot = previous.actors,
    actors = clone(snapshot),
    events: Event[] = [],
    matched = new Set<string>();
  const structures = deriveStructures(world, snapshot);
  for (const rule of world.rules) {
    if (!rule.enabled) continue;
    for (const a of snapshot) {
      if (a.removed || (rule.subject !== "*" && a.asset !== rule.subject))
        continue;
      let applies = false;
      if (rule.trigger === "marked") applies = a.marks.includes(rule.token);
      if (rule.trigger === "neighbor")
        applies = snapshot.some(
          (b) =>
            b.id !== a.id &&
            !b.removed &&
            (rule.source === "*" || b.asset === rule.source) &&
            b.marks.includes(rule.token) &&
            distance(a, b) <= rule.radius,
        );
      if (player && rule.trigger === "approach")
        applies = distance(a, player) <= rule.radius;
      if (player && rule.trigger === "gaze") {
        const angle =
          Math.atan2(a.x - player.x, -(a.z - player.z)) - player.yaw;
        const center =
          (floorHeight(world, a.x, a.z, structures) ?? 0) + 0.8 * a.scale;
        const eye =
          (floorHeight(world, player.x, player.z, structures) ?? 0) + 1.55;
        const elevation = Math.atan2(center - eye, distance(a, player) * 2);
        applies =
          distance(a, player) <= rule.radius &&
          Math.cos(angle) > 0.985 &&
          Math.abs(elevation - (player.pitch ?? 0)) < 0.24 &&
          lineOfSight(world, snapshot, player, a, structures);
      }
      if (!applies) continue;
      const key = rule.id + ":" + a.id;
      matched.add(key);
      if (previous.matched.has(key)) continue;
      const next = actors.find((o) => o.id === a.id)!;
      if (next.removed) continue;
      const name = world.assets.find((s) => s.id === a.asset)?.name ?? "사물";
      let message = "";
      if (rule.action === "mark") {
        if (next.marks.includes(rule.result)) continue;
        next.marks.push(rule.result);
        message = `${name}에 ${rule.result} 표시가 생겼습니다.`;
      }
      if (rule.action === "sound") message = `${name}이 소리를 냈습니다.`;
      if (rule.action === "disappear") {
        next.removed = true;
        message = `${name}이 사라졌습니다.`;
      }
      if (rule.action === "change") {
        if (
          !world.assets.some((s) => s.id === rule.replacement) ||
          next.asset === rule.replacement
        )
          continue;
        next.asset = rule.replacement;
        message = `${name}의 모습이 바뀌었습니다.`;
      }
      if (rule.action === "move") {
        const x = Math.round(
            next.x + Math.sin((next.rotation * Math.PI) / 180),
          ),
          z = Math.round(next.z - Math.cos((next.rotation * Math.PI) / 180));
        if (
          x < 0 ||
          z < 0 ||
          x >= world.size ||
          z >= world.size ||
          actors.some(
            (b) => !b.removed && b.id !== a.id && b.x === x && b.z === z,
          )
        )
          continue;
        next.x = x;
        next.z = z;
        message = `${name}이 한 칸 움직였습니다.`;
      }
      if (message)
        events.push({
          ruleId: rule.id,
          objectId: a.id,
          asset: a.asset,
          action: rule.action,
          message,
          x: a.x,
          z: a.z,
        });
    }
  }
  return { actors, matched, tick: previous.tick + 1, events };
}
export function describeRule(r: Rule, w: World) {
  const name = (id: string) =>
    id === "*"
      ? "모든 사물"
      : (w.assets.find((a) => a.id === id)?.name ?? "사물");
  const subject = name(r.subject);
  const condition =
    r.trigger === "gaze"
      ? `${subject}을 바라보면`
      : r.trigger === "approach"
        ? `${subject}에 가까이 가면`
        : r.trigger === "marked"
          ? `${subject}에 ${r.token} 표시가 있으면`
          : `${subject} 가까이에 ${r.token} 표시의 ${name(r.source)}이 있으면`;
  const action =
    r.action === "mark"
      ? `${r.result} 표시 붙이기`
      : r.action === "sound"
        ? "소리 내기"
        : r.action === "disappear"
          ? "사라지기"
          : r.action === "move"
            ? "앞으로 한 칸 이동"
            : `${name(r.replacement)}으로 변하기`;
  return { condition, action };
}
export function validateWorld(input: unknown, libraryLimit = MAX_CONTENT_COUNT): World {
  if (!input || typeof input !== "object")
    throw Error("파일을 읽을 수 없습니다.");
  const w = input as World;
  const shapes = [
    "cone",
    "ring",
    "bar",
    "diamond",
    "tree",
    "flower",
    "arch",
    "bell",
    "stone",
    "box",
    "sphere",
    "image",
  ];
  const number = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  if (
    w.version !== 1 ||
    (w.timeOfDay !== undefined && !["auto", "noon", "midnight"].includes(w.timeOfDay)) ||
    (w.weather !== undefined && !["clear", "cloud", "rain", "snow"].includes(w.weather)) ||
    !text(w.title, 60) ||
    !text(w.description, 300) ||
    !Number.isInteger(w.size) ||
    !number(w.size, 6, 24) ||
    !Array.isArray(w.assets) ||
    w.assets.length < 1 ||
    w.assets.length > MAX_LIBRARY_SIZE ||
    (w.receivedMaterialIds !== undefined && (!Array.isArray(w.receivedMaterialIds) || w.receivedMaterialIds.length > 10000 || w.receivedMaterialIds.some(id=>!text(id,100)))) ||
    !Array.isArray(w.objects) ||
    w.objects.length > 250 ||
    !Array.isArray(w.rules) ||
    w.rules.length > 40
  )
    throw Error("지원하지 않는 파일 형식입니다.");
  const ids = new Set<string>();
  if (w.workshop !== undefined) {
    const s = w.workshop;
    if (!s || (s.lastGate !== undefined && !text(s.lastGate, 80)) || !text(s.id, 40) || !/^[a-zA-Z0-9-]+$/.test(s.id) || !Number.isSafeInteger(s.serial) || !number(s.serial, 0, 1000000) ||
        !Number.isInteger(s.next) || !number(s.next, 0, 2) || !Array.isArray(s.pending) || s.pending.length > 6 ||
        s.pending.some(p => !p || !["image", "text", "sound"].includes(p.kind) ||
          !Number.isInteger(p.x) || !Number.isInteger(p.z) || !number(p.x, 0, w.size - 1) || !number(p.z, 0, w.size - 1) ||
          (p.title !== undefined && typeof p.title !== "boolean"))) throw Error("기호 데이터가 올바르지 않습니다.");
    if (s.growth !== undefined) {
      const g = s.growth, cells = w.size * w.size;
      const validCells = (value: unknown): value is number[] => Array.isArray(value) && value.length <= cells &&
        value.every(i => Number.isInteger(i) && i >= 0 && i < cells);
      if (!g || !validCells(g.seen) || new Set(g.seen).size !== g.seen.length ||
          !Number.isInteger(g.remainder) || !number(g.remainder, 0, 2) || !validCells(g.pending) ||
          !Array.isArray(g.islands) || g.islands.length > cells || !g.islands.every(i => validCells(i) && i.length > 0) ||
          g.islands.flat().length > cells || new Set(g.islands.flat()).size !== g.islands.flat().length)
        throw Error("기호 데이터가 올바르지 않습니다.");
    }
  }
  if (w.connectionFootings !== undefined) {
    const footings = w.connectionFootings;
    if (!Array.isArray(footings) || footings.length > w.size * 2 || footings.some(p =>
      !p || !text(p.id, 100) || !p.id || ![0, 1].includes(p.side) ||
      !Number.isInteger(p.row) || !number(p.row, 0, w.size - 1) || typeof p.built !== "boolean" ||
      !Number.isSafeInteger(p.created) || p.created < 0) ||
      new Set(footings.map(p => p.id)).size !== footings.length ||
      new Set(footings.map(p => `${p.side}:${p.row}`)).size !== footings.length)
      throw Error("연결 발판 데이터가 올바르지 않습니다.");
  }
  for (const a of w.assets) {
    if (
      !text(a.id, a.received ? 100 : 80) ||
      ids.has(a.id) ||
      !text(a.name, 40) ||
      !shapes.includes(a.shape) ||
      !/^#[0-9a-f]{6}$/i.test(a.color) ||
      (a.glyphColor !== undefined && !/^#[0-9a-f]{6}$/i.test(a.glyphColor)) ||
      (a.received !== undefined && typeof a.received !== "boolean") ||
      (a.prompt !== undefined && (!a.prompt || !["image", "text", "sound"].includes(a.prompt.kind) ||
        (a.prompt.reward !== undefined && (a.prompt.reward !== true || a.prompt.title)) ||
        (a.prompt.title !== undefined && (typeof a.prompt.title !== "boolean" || a.prompt.kind !== "text")))) ||
      typeof a.solid !== "boolean" ||
      (a.sound !== undefined && (!validRecording(a.sound) || a.solid || a.image !== undefined || a.text !== undefined)) ||
      (a.placement !== undefined && !["upright", "floating", "surface", "field"].includes(a.placement)) ||
      (a.textColor !== undefined && !/^#[0-9a-f]{6}$/i.test(a.textColor)) ||
      (a.display !== undefined && !["steady", "nearby", "pulse"].includes(a.display)) ||
      (a.motion !== undefined && !["still", "wind"].includes(a.motion)) ||
      (a.defaultScale !== undefined &&
        ![0.5, 1, 2, 3].includes(a.defaultScale)) ||
      (a.text !== undefined && (!text(a.text, MAX_TEXT_LENGTH) || !a.text.trim())) ||
      [a.image, a.originalImage].some(
        (image) =>
          image !== undefined &&
          (!text(image, 400000) ||
            !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(
              image,
            )),
      )
    )
      throw Error("사물 데이터가 올바르지 않습니다.");
    ids.add(a.id);
  }
  validateContentCounts(w, libraryLimit);
  const placed = new Set<string>();
  for (const o of w.objects) {
    if (
      !text(o.id, 80) ||
      placed.has(o.id) ||
      !ids.has(o.asset) ||
      !Number.isInteger(o.x) ||
      !Number.isInteger(o.z) ||
      !number(o.x, 0, w.size - 1) ||
      !number(o.z, 0, w.size - 1) ||
      !number(o.scale, 0.4, 3) ||
      !number(o.rotation, 0, 359)
    )
      throw Error("사물 위치가 올바르지 않습니다.");
    if (o.site !== undefined && (!o.site || !["cluster", "peak", "boundary"].includes(o.site.kind) ||
        !Array.isArray(o.site.cells) || !o.site.cells.length || o.site.cells.length > w.size * w.size ||
        o.site.cells.some(i => !Number.isInteger(i) || !number(i, 0, w.size * w.size - 1)) ||
        !number(o.site.height, -20, 20))) throw Error("기호 자리 데이터가 올바르지 않습니다.");
    placed.add(o.id);
  }
  const ruleIds = new Set<string>();
  for (const r of w.rules) {
    if (
      !text(r.id, 80) ||
      ruleIds.has(r.id) ||
      (!ids.has(r.subject) && r.subject !== "*") ||
      !["gaze", "approach", "marked", "neighbor"].includes(r.trigger) ||
      !["mark", "sound", "disappear", "change", "move"].includes(r.action) ||
      !text(r.token, 20) ||
      !text(r.result, 20) ||
      !number(r.radius, 0.5, 6) ||
      typeof r.enabled !== "boolean" ||
      (!ids.has(r.source) && r.source !== "*") ||
      (r.action === "change" && !ids.has(r.replacement))
    )
      throw Error("규칙 데이터가 올바르지 않습니다.");
    ruleIds.add(r.id);
  }
  if (
    !w.start ||
    !Number.isInteger(w.start.x) ||
    !Number.isInteger(w.start.z) ||
    !number(w.start.x, 0, w.size - 1) ||
    !number(w.start.z, 0, w.size - 1) ||
    !/^#[0-9a-f]{6}$/i.test(w.sky)
  )
    throw Error("시작 위치가 올바르지 않습니다.");
  if (w.terrain !== undefined) {
    const t = w.terrain;
    if (
      !t ||
      (t.floating !== undefined && typeof t.floating !== "boolean") ||
      (t.generatorVersion !== undefined && t.generatorVersion !== 2) ||
      !Number.isInteger(t.seed) ||
      !number(t.seed, 0, 4294967295) ||
      !Array.isArray(t.tiles) ||
      t.tiles.length !== w.size * w.size ||
      t.tiles.some(
        (tile) =>
          !tile ||
          !Number.isInteger(tile.height) ||
          !number(tile.height, MIN_HEIGHT, MAX_HEIGHT) ||
          (tile.void !== undefined && (typeof tile.void !== "boolean" || (tile.void && (!t.floating || tile.hole)))) ||
          (tile.hole !== undefined && typeof tile.hole !== "boolean") ||
          !["plain", "rough", "slick", "soft"].includes(tile.surface),
      ) ||
      !t.patterns ||
      ["stairs", "bridge", "canopy"].some(
        (key) =>
          typeof t.patterns[key as keyof typeof t.patterns] !== "boolean",
      )
    )
      throw Error("지형 데이터가 올바르지 않습니다.");
    if (isGap(t.tiles[w.start.z * w.size + w.start.x]))
      throw Error("시작점에는 바닥이 필요합니다.");
  }
  return clone(w);
}
