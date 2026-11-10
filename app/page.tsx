"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { lazy, Suspense, type ComponentProps } from "react";
import { useLanguage, SceneLoading } from "@/components/whistle/Language";

import {
  starterWorld,
  abstractWorld,
  createSimulation,
  stepSimulation,
  validateWorld,
  clone,
  uid,
  type World,
  type Asset,
  type Placed,
  type Player,
  type Event,
  type Simulation,
} from "@/lib/world";
import { editTile, isHole, type TerrainTool } from "@/lib/tile";
import { deriveEnvironment } from "@/lib/environment";
import {
  placementChanges,
  type PlacementFeedback,
} from "@/lib/placement-feedback";
import { decodeWorld, downloadWorld } from "@/lib/sharing";
import { WeatherControls } from "@/components/whistle/WeatherControls";
import { PaintGrid } from "@/components/whistle/PaintGrid";
import {
  EnvironmentTile,
  environmentTileKind,
} from "@/components/whistle/EnvironmentTile";
import {
  generateTerrain,
  upgradeTerrain,
  flatTerrain,
  deriveStructures,
  tileAt,
  SURFACES,
  type Surface,
} from "@/lib/terrain";
import { ObjectArt } from "@/components/whistle/Art";
import {
  Dialog,
  AssetMaker,
  ShareDialog,
  SizeOptions,
} from "@/components/whistle/Dialogs";
const LazyScene = lazy(() => import("@/components/whistle/Scene"));
function Scene(props: ComponentProps<typeof LazyScene>) {
  return <Suspense fallback={<SceneLoading />}><LazyScene {...props} /></Suspense>;
}
function terrainWorld() {
  const w = starterWorld();
  w.objects = [];
  w.terrain = generateTerrain(
    w.size,
    crypto.getRandomValues(new Uint32Array(1))[0],
  );
  return w;
}
const STORAGE = "whistle.world.v2";
export default function Home() {
  const { language, setLanguage, t } = useLanguage();
  const [world, setWorld] = useState<World>(starterWorld),
    [ready, setReady] = useState(false),
    [saveStatus, setSaveStatus] = useState("준비 중"),
    [selectedAsset, setSelectedAsset] = useState("circle"),
    [selected, setSelected] = useState<string | null>(null),
    [placingStart, setPlacingStart] = useState(false);
  const [simulation, setSimulation] = useState<Simulation>(() =>
      createSimulation(starterWorld()),
    ),
    [playing, setPlaying] = useState(false),
    [log, setLog] = useState<Event[]>([]),
    [toast, setToast] = useState(""),
    [showMaker, setShowMaker] = useState(false),
    [editingAsset, setEditingAsset] = useState<Asset | undefined>(),
    [share, setShare] = useState(false),
    [newDialog, setNewDialog] = useState(false),
    [playKey, setPlayKey] = useState(0);
  const makeButton = useRef<HTMLButtonElement>(null);
  const hasPlayed = useRef(false);
  useLayoutEffect(() => {
    if (!playing && !hasPlayed.current) return;
    hasPlayed.current = true;
    const overflow = document.body.style.overflow;
    if (playing) document.body.style.overflow = "hidden";
    window.scrollTo({top: 0, left: 0, behavior: "instant"});
    if (!playing) makeButton.current?.focus({preventScroll: true});
    const frame = requestAnimationFrame(() => window.scrollTo({top: 0, left: 0, behavior: "instant"}));
    return () => {
      cancelAnimationFrame(frame);
      if (playing) document.body.style.overflow = overflow;
    };
  }, [playing]);
  const [movementMode, setMovementMode] = useState<"walk" | "crouch">("walk");
  const [layer, setLayer] = useState<"tiles" | "symbols">("tiles"),
    [surface, setSurface] = useState<Surface>("plain"),
    [terrainTool, setTerrainTool] = useState<TerrainTool>("surface");
  const strokeBase = useRef<World | null>(null);
  const [feedback, setFeedback] = useState<PlacementFeedback | null>(null);
  const feedbackId = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const structures = useMemo(
    () => deriveStructures(world, simulation.actors),
    [world, simulation.actors],
  );
  const environment = useMemo(
    () => deriveEnvironment(world, structures),
    [world, structures],
  );
  const environmentLabels = (i: number) => {
    const c = environment.cells[i];
    return [
      c.grass > 0 ? t("풀") : "",
      c.tree ? t("나무") : "",
      c.water !== null ? t("물") : "",
      c.fog > 0.05 ? t("안개") : "",
      Math.hypot(c.windX, c.windZ) > 0.1 ? t("바람") : "",
      c.light < 0.7 ? t("그늘") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const history = useRef<World[]>([]),
    future = useRef<World[]>([]),
    worldRef = useRef(world),
    simulationRef = useRef(simulation),
    player = useRef<Player>({ ...world.start, yaw: 0 }),
    controls = useRef(new Set<string>()),
    padPressedAt = useRef(new Map<string, number>()),
    file = useRef<HTMLInputElement>(null),
    audio = useRef<AudioContext | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  worldRef.current = world;
  simulationRef.current = simulation;
  useEffect(() => {
    if (!world.assets.some((a) => a.id === selectedAsset)) {
      setSelectedAsset(world.assets[0]?.id ?? "");
      setPlacingStart(false);
    }
  }, [world.assets, selectedAsset]);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  useEffect(() => {
    let active = true,
      generation = 0;
    const load = async (initial: boolean) => {
      const encoded = new URLSearchParams(location.hash.slice(1)).get("world");
      if (!initial && !encoded) return;
      const request = ++generation;
      setReady(false);
      try {
        let incoming: World | undefined;
        if (encoded) incoming = await decodeWorld(encoded);
        else {
          const stored = localStorage.getItem(STORAGE);
          if (stored) incoming = validateWorld(JSON.parse(stored));
          else {
            const previous = localStorage.getItem("whistle.world.v1");
            if (previous)
              incoming = abstractWorld(validateWorld(JSON.parse(previous)));
          }
        }
        if (!incoming) incoming = terrainWorld();
        const previousTerrain = incoming;
        incoming = upgradeTerrain(incoming);
        if (!active || request !== generation) return;
        if (incoming) {
          setWorld(incoming);
          worldRef.current = incoming;
          const sim = createSimulation(incoming);
          setSimulation(sim);
          simulationRef.current = sim;
          setSelectedAsset(incoming.assets[0].id);
          setSelected(null);
          setLog([]);
          setPlaying(false);
          history.current =
            incoming !== previousTerrain ? [clone(previousTerrain)] : [];
          if (history.current[0]?.terrain)
            history.current[0].terrain.generatorVersion = 2;
          future.current = [];
          player.current = { ...incoming.start, yaw: 0 };
        }
        if (encoded) {
          window.history.replaceState(
            null,
            "",
            location.pathname + location.search,
          );
        }
      } catch (e) {
        if (active && request === generation)
          notify(
            e instanceof Error ? e.message : "저장한 세계를 불러오지 못했어요.",
          );
      } finally {
        if (active && request === generation) setReady(true);
      }
    };
    void load(true);
    const changed = () => void load(false);
    window.addEventListener("hashchange", changed);
    return () => {
      active = false;
      window.removeEventListener("hashchange", changed);
    };
  }, [notify]);
  useEffect(() => {
    if (!ready) return;
    setSaveStatus("저장 중");
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(world));
        setSaveStatus("이 브라우저에 저장됨");
      } catch {
        setSaveStatus("저장 공간 부족 · 파일로 보관");
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [world, ready]);
  const reset = useCallback((w: World = worldRef.current) => {
    const next = createSimulation(w);
    simulationRef.current = next;
    setSimulation(next);
    setLog([]);
    player.current = { ...w.start, yaw: 0 };
  }, []);
  const revealChanges = useCallback((next: World) => {
    const cells = placementChanges(worldRef.current, next);
    if (!cells.length) return;
    setFeedback({ id: ++feedbackId.current, cells });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400);
  }, []);
  const updateWorld = useCallback(
    (next: World) => {
      revealChanges(next);
      history.current.push(clone(worldRef.current));
      if (history.current.length > 40) history.current.shift();
      future.current = [];
      setWorld(next);
      worldRef.current = next;
      reset(next);
    },
    [reset, revealChanges],
  );
  const change = (fn: (w: World) => void) => {
    const next = clone(worldRef.current);
    fn(next);
    updateWorld(next);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(clone(world));
    revealChanges(prev);
    setWorld(prev);
    worldRef.current = prev;
    reset(prev);
    setSelected(null);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(world));
    revealChanges(next);
    setWorld(next);
    worldRef.current = next;
    reset(next);
    setSelected(null);
  };
  const initAudio = () => {
    if (!audio.current || audio.current.state === "closed") {
      try {
        audio.current = new AudioContext();
      } catch {
        return;
      }
    }
    void audio.current.resume().catch(() => {});
  };
  const sound = (event: Event) => {
    if (!audio.current || audio.current.state === "closed") return;
    const ctx = audio.current,
      osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      pan = ctx.createStereoPanner();
    const p = player.current,
      distance = Math.hypot(event.x - p.x, event.z - p.z),
      angle = Math.atan2(event.x - p.x, -(event.z - p.z)) - p.yaw;
    osc.type = "sine";
    osc.frequency.value = [261.63, 329.63, 392, 523.25, 659.25][
      Math.abs(Math.round(event.x + event.z)) % 5
    ];
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(
      0.12 / (1 + distance * 0.3),
      ctx.currentTime + 0.025,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
    pan.pan.value = Math.sin(angle);
    osc.connect(gain).connect(pan).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
  };
  const step = useCallback(() => {
    if (player.current.falling) return;
    const next = stepSimulation(
      worldRef.current,
      simulationRef.current,
      player.current,
    );
    simulationRef.current = next;
    setSimulation(next);
    if (next.events.length) {
      setLog((prev) => [...next.events, ...prev].slice(0, 12));
      next.events.filter((e) => e.action === "sound").forEach(sound);
    }
  }, []);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(step, 700);
    return () => clearInterval(interval);
  }, [playing, step]);
  const enter = () => {
    initAudio();
    reset();
    setPlaying(true);
    setPlayKey((k) => k + 1);
    controls.current.clear();
    setMovementMode("walk");
  };
  const exit = () => {
    setPlaying(false);
    controls.current.clear();
    setMovementMode("walk");
    reset();
  };
  useEffect(() => {
    if (!playing) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [playing]);
  useEffect(
    () => () => {
      const context = audio.current;
      audio.current = null;
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const clickedCell = (x: number, z: number) => {
    const existing = world.objects.find((o) => o.x === x && o.z === z);
    if (placingStart) {
      if (!tileAt(world, x, z) || isHole(tileAt(world, x, z))) {
        notify("시작점에는 바닥이 필요해요.");
        return;
      }
      if (
        existing &&
        world.assets.find((a) => a.id === existing.asset)?.solid
      ) {
        notify("시작점이 막혀 있습니다.");
        return;
      }
      change((w) => {
        w.start = { x, z };
      });
      setPlacingStart(false);
      return;
    }
    if (existing) {
      change((w) => {
        w.objects = w.objects.filter((o) => o.id !== existing.id);
      });
      setSelected(null);
      return;
    }
    const asset = world.assets.find((a) => a.id === selectedAsset);
    if (!asset) return;
    if (world.objects.length >= 250) {
      notify("최대 250개");
      return;
    }
    if (asset.solid && x === world.start.x && z === world.start.z) {
      notify("시작점이 막혀 있습니다.");
      return;
    }
    change((w) => {
      w.objects.push({
        id: uid(),
        asset: asset.id,
        x,
        z,
        rotation: 0,
        scale: asset.defaultScale ?? 1,
      });
    });
  };
  const paint = (cells: number[], erase: boolean) => {
    if (placingStart) {
      const i = cells[cells.length - 1];
      clickedCell(i % world.size, Math.floor(i / world.size));
      return;
    }
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
            id: uid(),
            asset: asset.id,
            x,
            z,
            rotation: 0,
            scale: asset.defaultScale ?? 1,
          });
      }
    }
    if (first) updateWorld(next);
    else {
      revealChanges(next);
      setWorld(next);
      worldRef.current = next;
      reset(next);
    }
  };
  const reroll = () =>
    change((w) => {
      w.terrain = generateTerrain(
        w.size,
        crypto.getRandomValues(new Uint32Array(1))[0],
      );
      w.terrain.tiles[w.start.z * w.size + w.start.x] = {
        height: 0,
        surface: "plain",
      };
    });
  const selectedObject = world.objects.find((o) => o.id === selected),
    chosenAsset = world.assets.find((a) => a.id === selectedObject?.asset);
  const patchObject = (patch: Partial<Placed>) =>
    change((w) => {
      const o = w.objects.find((o) => o.id === selected);
      if (o) Object.assign(o, patch);
    });
  const saveAsset = (asset: Asset) => {
    if (!editingAsset && world.assets.length >= 40) {
      notify("첫 버전에서는 사물을 40종류까지 만들 수 있어요.");
      return;
    }
    change((w) => {
      const index = w.assets.findIndex((a) => a.id === asset.id);
      if (
        index >= 0 &&
        (w.assets[index].defaultScale ?? 1) !== (asset.defaultScale ?? 1)
      ) {
        for (const object of w.objects) {
          if (object.asset === asset.id) object.scale = asset.defaultScale ?? 1;
        }
      }
      if (index >= 0) w.assets[index] = asset;
      else w.assets.push(asset);
    });
    setSelectedAsset(asset.id);
    setLayer("symbols");
    setPlacingStart(false);
    setShowMaker(false);
    setEditingAsset(undefined);
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      if (f.size > 6000000)
        throw Error("6MB 이하의 세계 파일을 선택해 주세요.");
      const imported = upgradeTerrain(
        validateWorld(JSON.parse(await f.text())),
      );
      updateWorld(imported);
      setSelectedAsset(imported.assets[0].id);
      setSelected(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "세계 파일을 읽을 수 없어요.");
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const newWorld = () => {
    const next = terrainWorld();
    updateWorld(next);
    setSelected(null);
    setSelectedAsset(next.assets[0].id);
    setNewDialog(false);
  };
  return (
    <main className={`studio ${playing ? "playing" : ""}`}>
      <header className="topbar" hidden={playing}>
        <h1>Whistle</h1>
        <nav className="view-tabs" aria-label={t("화면")}>
          <button
            ref={makeButton}
            className={!playing ? "active" : ""}
            onClick={() => {
              if (playing) exit();
            }}
          >
            {t("만들기")}
          </button>
          <button
            className={playing ? "active" : ""}
            aria-pressed={playing}
            onClick={() => {
              if (!playing) enter();
            }}
          >
            {t("플레이")}
          </button>
        </nav>
        <div className="header-tools">
          <div className="language-switch" role="group" aria-label={t("언어")}>
            <button
              lang="ko"
              aria-label="한국어"
              aria-pressed={language === "ko"}
              onClick={() => setLanguage("ko")}
            >
              KO
            </button>
            <span aria-hidden="true">/</span>
            <button
              lang="en"
              aria-label="English"
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
          </div>
          <div className="file-actions">
            <button onClick={() => setNewDialog(true)}>{t("다시 시작")}</button>
            <button onClick={() => file.current?.click()}>
              {t("불러오기")}
            </button>
            <button
              onClick={() => setShare(true)}
              aria-description={t(saveStatus)}
            >
              {t("공유")}
            </button>
          </div>
        </div>
      </header>
      {playing && (
        <section className="play-shell">
          <Scene
            key={playKey}
            world={world}
            simulation={simulation}
            mode="play"
            onPlayer={(p) => (player.current = p)}
            controls={controls}
            onControlsReset={() => setMovementMode("walk")}
          />
          <button className="play-return" aria-label={t("만들기로 돌아가기")} onClick={exit}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
          </button>
          <div className="crosshair" />
          <div className="touch-controls" aria-label={t("이동 터치패드")}>
            {(
              [
                {
                  key: "forward",
                  command: "step",
                  className: "direction-forward",
                  label: "앞으로",
                  glyph: "⌃",
                },
                {
                  key: "left",
                  command: "turn-left",
                  className: "direction-left",
                  label: "왼쪽으로 회전",
                  glyph: "‹",
                },
                {
                  key: "backward",
                  command: "backstep",
                  className: "direction-back",
                  label: "뒤로",
                  glyph: "⌄",
                },
                {
                  key: "right",
                  command: "turn-right",
                  className: "direction-right",
                  label: "오른쪽으로 회전",
                  glyph: "›",
                },
              ] as const
            ).map(({ key, command, className, label, glyph }) => (
              <button
                key={key}
                className={className}
                aria-label={t(label)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  padPressedAt.current.set(key, performance.now());
                  controls.current.add(key);
                }}
                onPointerUp={() => {
                  controls.current.delete(key);
                  if (
                    performance.now() - (padPressedAt.current.get(key) ?? 0) <
                    180
                  )
                    controls.current.add(command);
                  padPressedAt.current.delete(key);
                }}
                onPointerCancel={() => {
                  controls.current.delete(key);
                  padPressedAt.current.delete(key);
                }}
                onLostPointerCapture={() => controls.current.delete(key)}
                onClick={(e) => {
                  if (e.detail === 0) controls.current.add(command);
                }}
              >
                <span aria-hidden="true">{glyph}</span>
              </button>
            ))}
            <div className="movement-modes">
              <button aria-label={t("점프")}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (!player.current.falling) controls.current.add("jump");
                }}
                onClick={(e) => {
                  if (e.detail === 0 && !player.current.falling) controls.current.add("jump");
                }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 14l4-4 4 4" /></svg>
              </button>
              <button aria-label={t("기어가기")}
                aria-pressed={movementMode === "crouch"}
                onClick={() => {
                  if (player.current.falling) return;
                  const next = movementMode === "crouch" ? "walk" : "crouch";
                  controls.current.delete("run");
                  controls.current.delete("crouch");
                  if (next === "crouch") controls.current.add("crouch");
                  setMovementMode(next);
                }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4" /></svg>
              </button>
            </div>
          </div>
          <span className="sr-only" aria-live="polite">
            {log[0]?.message}
          </span>
        </section>
      )}
        <div className="workspace" hidden={playing}>
          <aside className="palette direct-palette" aria-label={t("재료")}>
            <div className="layer-tabs compact-layer-tabs">
              <button
                aria-label={t("타일")}
                aria-pressed={layer === "tiles"}
                className={layer === "tiles" ? "active" : ""}
                onClick={() => {
                  setLayer("tiles");
                  setPlacingStart(false);
                }}
              >
                <svg
                  className="layer-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </button>
              <button
                aria-label={t("기호")}
                aria-pressed={layer === "symbols"}
                className={layer === "symbols" ? "active" : ""}
                onClick={() => {
                  setLayer("symbols");
                  setPlacingStart(false);
                }}
              >
                <svg
                  className="layer-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" fill="currentColor" />
                </svg>
              </button>
            </div>
            {layer === "tiles" ? (
              <div className="tile-palette">
                <div className="surface-choices">
                  {SURFACES.map((entry) => (
                    <button
                      key={entry.id}
                      aria-label={t(entry.name)}
                      aria-pressed={
                        layer === "tiles" &&
                        surface === entry.id &&
                        terrainTool === "surface" &&
                        !placingStart
                      }
                      className={`surface-choice ${layer === "tiles" && surface === entry.id && terrainTool === "surface" && !placingStart ? "active" : ""}`}
                      onClick={() => {
                        setLayer("tiles");
                        setPlacingStart(false);
                        setSurface(entry.id);
                        setTerrainTool("surface");
                      }}
                    >
                      <span className={`surface-swatch surface-${entry.id}`} />
                    </button>
                  ))}
                </div>
                <div className="terrain-options">
                  <div className="height-choices" aria-label={t("바닥 높이")}>
                    {(["raise", "lower"] as const).map((tool) => (
                      <button
                        key={tool}
                        aria-label={t(tool === "raise" ? "높이기" : "낮추기")}
                        aria-pressed={
                          layer === "tiles" && terrainTool === tool && !placingStart
                        }
                        className={
                          layer === "tiles" && terrainTool === tool && !placingStart
                            ? "active"
                            : ""
                        }
                        onClick={() => {
                          setLayer("tiles");
                          setPlacingStart(false);
                          setTerrainTool(tool);
                        }}
                      >
                        {tool === "raise" ? "＋" : "−"}
                      </button>
                    ))}
                  </div>
                  <div className="terrain-actions">
                    <button
                      className={`clear-tile ${layer === "tiles" && terrainTool === "hole" ? "active" : ""}`}
                      aria-label={t("구멍")}
                      aria-pressed={layer === "tiles" && terrainTool === "hole"}
                      onClick={() => {
                        setLayer("tiles");
                        setPlacingStart(false);
                        setTerrainTool("hole");
                      }}
                    >
                      <span aria-hidden="true" />
                    </button>
                    <button aria-label={t("다른 지형")} onClick={reroll}>
                      <span aria-hidden="true">↻</span>
                    </button>
                  </div>
                  <WeatherControls className="weather-desktop" value={world.weather}
                    onChange={(weather) => change((w) => { w.weather = weather; })} />
                </div>
              </div>
            ) : (
              <div className="symbols">
                {world.assets.map((a) => (
                  <button
                    key={a.id}
                    aria-label={`${a.name} · ${t("이미지 편집")}`}
                    aria-pressed={
                      layer === "symbols" &&
                      selectedAsset === a.id &&
                      !placingStart
                    }
                    className={
                      layer === "symbols" &&
                      selectedAsset === a.id &&
                      !placingStart
                        ? "active"
                        : ""
                    }
                    onClick={() => {
                      setLayer("symbols");
                      setSelectedAsset(a.id);
                      setSelected(null);
                      setPlacingStart(false);
                      setEditingAsset(a);
                      setShowMaker(true);
                    }}
                  >
                    <ObjectArt asset={a} />
                    {a.image && (
                      <img className="symbol-media" src={a.image} alt="" />
                    )}
                  </button>
                ))}
                <button
                  aria-label={t("시작점")}
                  aria-pressed={placingStart}
                  className={
                    placingStart ? "active start-choice" : "start-choice"
                  }
                  onClick={() => {
                    setLayer("symbols");
                    setPlacingStart(!placingStart);
                  }}
                >
                  ◎
                </button>
              </div>
            )}
          </aside>
          <section className="canvas-panel">
            <div className="canvas-area">
              <PaintGrid
                size={world.size}
                occupied={(i) =>
                  world.objects.some(
                    (o) =>
                      o.x === i % world.size &&
                      o.z === Math.floor(i / world.size),
                  )
                }
                canHold={layer === "symbols" && !placingStart}
                onPaint={paint}
                onEnd={() => {
                  strokeBase.current = null;
                }}
                onHold={(i) =>
                  setSelected(
                    world.objects.find(
                      (o) =>
                        o.x === i % world.size &&
                        o.z === Math.floor(i / world.size),
                    )?.id ?? null,
                  )
                }
                cellClass={(i) => {
                  const tile = tileAt(
                    world,
                    i % world.size,
                    Math.floor(i / world.size),
                  )!;
                  const c = environment.cells[i];
                  return `surface-${environmentTileKind(c) ? "plain" : tile.surface} level-${tile.height} ${isHole(tile) ? "tile-void" : ""} ${c.grass ? "has-grass" : ""} ${c.water !== null ? "has-water" : ""} ${c.tree ? "has-tree" : ""} ${c.fog > 0.05 ? "has-fog" : ""}`;
                }}
                label={(i) => {
                  const x = i % world.size,
                    z = Math.floor(i / world.size),
                    tile = tileAt(world, x, z)!;
                  const object = world.objects.find(
                    (o) => o.x === x && o.z === z,
                  );
                  return `${String.fromCharCode(65 + x)}${z + 1} ${isHole(tile) ? t("빈틈") : `${t("높이")} ${tile.height} ${t(SURFACES.find((s) => s.id === tile.surface)!.name)}`}${object ? " " + world.assets.find((a) => a.id === object.asset)?.name : ""}${x === world.start.x && z === world.start.z ? " " + t("시작점") : ""} ${environmentLabels(i)}`;
                }}
                renderCell={(i) => {
                  const x = i % world.size,
                    z = Math.floor(i / world.size),
                    tile = tileAt(world, x, z)!;
                  const actor = simulation.actors.find(
                    (a) => a.x === x && a.z === z && !a.removed,
                  );
                  const asset = world.assets.find((a) => a.id === actor?.asset);
                  const generated = structures.filter(
                    (t) => t.x === x && t.z === z,
                  );
                  const conditions = environment.cells[i];
                  const reaction = feedback?.cells.find((c) => c.index === i);
                  return (
                    <>
                      <span
                        className="environment-light"
                        aria-hidden="true"
                        style={{ opacity: (1 - conditions.light) * 0.2 }}
                      />
                      <EnvironmentTile cell={conditions} />
                      {tile.height !== 0 && !isHole(tile) && (
                        <span className="tile-height">{tile.height}</span>
                      )}
                      {generated.map((t) => (
                        <span
                          key={t.key}
                          className={`generated generated-${t.kind}`}
                          style={
                            t.kind === "stairs"
                              ? {
                                  transform: `rotate(${t.dx ? t.dx * 90 : t.dz === 1 ? 180 : 0}deg)`,
                                }
                              : t.kind === "bridge" && t.dz
                                ? { transform: "rotate(90deg)" }
                                : undefined
                          }
                        />
                      ))}
                      {asset && actor && (
                        <span
                          className="placed-art"
                          style={{
                            transform: `rotate(${actor.rotation}deg) scale(${actor.scale})`,
                          }}
                        >
                          <ObjectArt asset={asset} />
                        </span>
                      )}
                      {!!actor?.marks.length && (
                        <span className="cell-mark">{actor.marks[0]}</span>
                      )}
                      {x === world.start.x && z === world.start.z && (
                        <span className="start-marker" />
                      )}
                      {reaction && (
                        <span
                          key={`reaction-${feedback!.id}`}
                          aria-hidden="true"
                          className={`placement-reaction ${reaction.result ? "result-reaction" : "touch-reaction"} ${reaction.removed ? "removed-reaction" : ""}`}
                        />
                      )}
                    </>
                  );
                }}
              />
            </div>
            <div className="canvas-tools">
              <div className="history-tools">
                <button
                  aria-label={t("되돌리기")}
                  disabled={!history.current.length}
                  onClick={undo}
                >
                  ↶
                </button>
                <button
                  aria-label={t("다시 실행")}
                  disabled={!future.current.length}
                  onClick={redo}
                >
                  ↷
                </button>
              </div>
            </div>
          </section>
          <aside className="preview-panel" aria-label={t("배치 결과")}>
            <WeatherControls className="weather-mobile" value={world.weather}
              onChange={(weather) => change((w) => { w.weather = weather; })} />
            <div className="live-preview">
              {!playing && <Scene
                world={world}
                simulation={simulation}
                mode="overview"
                feedback={feedback}
              />}
              <button onClick={enter} aria-label={t("세계에 들어가기")}>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </aside>
        </div>
      <input
        ref={file}
        type="file"
        accept=".json,.whistle.json,application/json"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {selectedObject && chosenAsset && !showMaker && (
        <Dialog title={chosenAsset.name} onClose={() => setSelected(null)}>
          <div className="placement-settings">
            <button
              className="asset-link"
              onClick={() => {
                setEditingAsset(chosenAsset);
                setShowMaker(true);
              }}
            >
              {chosenAsset.image ? (
                <img src={chosenAsset.image} alt="" />
              ) : (
                <ObjectArt asset={chosenAsset} />
              )}
              {t("이미지")}
            </button>
            <button
              aria-label={t("회전")}
              onClick={() =>
                patchObject({ rotation: (selectedObject.rotation + 90) % 360 })
              }
            >
              ↻ {selectedObject.rotation}°
            </button>
            <SizeOptions
              value={selectedObject.scale}
              onChange={(scale) => patchObject({ scale })}
            />
          </div>
        </Dialog>
      )}
      {showMaker && (
        <AssetMaker
          asset={editingAsset}
          onSave={saveAsset}
          onClose={() => {
            setShowMaker(false);
            setEditingAsset(undefined);
          }}
        />
      )}
      {share && (
        <ShareDialog
          world={world}
          onClose={() => setShare(false)}
          onToast={notify}
        />
      )}
      {newDialog && (
        <Dialog title={t("다시 시작")} onClose={() => setNewDialog(false)}>
          <p>{t("지금 만든 세계를 지우고 새로 시작할까요?")}</p>
          <div className="new-actions">
            <button onClick={() => downloadWorld(world)}>
              {t("현재 파일 저장")}
            </button>
            <button className="primary" onClick={newWorld}>
              {t("다시 시작")}
            </button>
          </div>
        </Dialog>
      )}
      {saveStatus.includes("부족") && (
        <div className="save-error" role="alert">
          {t("저장 공간 부족")}{" "}
          <button onClick={() => downloadWorld(world)}>{t("파일 저장")}</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {t(toast)}
        </div>
      )}
    </main>
  );
}
