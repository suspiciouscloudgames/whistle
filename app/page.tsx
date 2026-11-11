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
import { createWorldDeriver, samePlacement } from "@/lib/world-derivation";
import {
  placementChanges,
  type PlacementFeedback,
} from "@/lib/placement-feedback";
import { decodeWorld, downloadWorld } from "@/lib/sharing";
import { WeatherControls } from "@/components/whistle/WeatherControls";
import { EditorToolbar } from "@/components/whistle/EditorToolbar";
import { EditorPalette } from "@/components/whistle/EditorPalette";
import { EditorBoard } from "@/components/whistle/EditorBoard";
import { PlayControls } from "@/components/whistle/PlayControls";
import {
  generateTerrain,
  upgradeTerrain,
  flatTerrain,
  tileAt,
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
  const { t } = useLanguage();
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
  const deriveWorld = useMemo(createWorldDeriver, []);
  const derivation = useMemo(
    () => deriveWorld(world, simulation.actors),
    [deriveWorld, world, simulation.actors],
  );
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
  const autosaveAllowed = useRef(false);
  const resumeAutosave = useCallback(() => {
    // A successful load (or explicit replacement) makes the current world safe to save.
    if (new URLSearchParams(location.hash.slice(1)).has("world")) {
      window.history.replaceState(null, "", location.pathname + location.search);
    }
    autosaveAllowed.current = true;
    setReady(true);
  }, []);
  useEffect(() => {
    let active = true,
      generation = 0;
    const load = async (initial: boolean) => {
      const encoded = new URLSearchParams(location.hash.slice(1)).get("world");
      if (!initial && encoded === null) return;
      const request = ++generation;
      // Block even an already-scheduled save while the incoming data is checked.
      autosaveAllowed.current = false;
      setReady(false);
      try {
        let incoming: World | undefined;
        if (encoded !== null) incoming = await decodeWorld(encoded);
        else {
          const stored = localStorage.getItem(STORAGE);
          if (stored !== null) incoming = validateWorld(JSON.parse(stored));
          else {
            const previous = localStorage.getItem("whistle.world.v1");
            if (previous !== null)
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
        resumeAutosave();
      } catch (e) {
        if (active && request === generation) {
          setSaveStatus("불러오기 실패 · 자동 저장 중지");
          notify(
            e instanceof Error ? e.message : "저장한 세계를 불러오지 못했어요.",
          );
        }
      }
    };
    void load(true);
    const changed = () => void load(false);
    window.addEventListener("hashchange", changed);
    return () => {
      active = false;
      window.removeEventListener("hashchange", changed);
    };
  }, [notify, resumeAutosave]);
  useEffect(() => {
    if (!ready) return;
    setSaveStatus("저장 중");
    const timeout = setTimeout(() => {
      if (!autosaveAllowed.current) return;
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
    const before = worldRef.current;
    const cells = placementChanges(before, next, deriveWorld(before), deriveWorld(next));
    if (!cells.length) return;
    setFeedback({ id: ++feedbackId.current, cells });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400);
  }, [deriveWorld]);
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
    if (samePlacement(worldRef.current, next)) {
      if (first) strokeBase.current = null;
      return;
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
      resumeAutosave();
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
    resumeAutosave();
    setSelected(null);
    setSelectedAsset(next.assets[0].id);
    setNewDialog(false);
  };
  return (
    <main className={`studio ${playing ? "playing" : ""}`}>
      <EditorToolbar
        playing={playing}
        saveStatus={saveStatus}
        makeButton={makeButton}
        onEnter={enter}
        onExit={exit}
        onNew={() => setNewDialog(true)}
        onImport={() => file.current?.click()}
        onShare={() => setShare(true)}
      />
      {playing && (
        <section className="play-shell">
          <Scene
            key={playKey}
            world={world}
            simulation={simulation}
            derivation={derivation}
            mode="play"
            onPlayer={(p) => (player.current = p)}
            controls={controls}
            onControlsReset={() => setMovementMode("walk")}
          />
          <button className="play-return" aria-label={t("만들기로 돌아가기")} onClick={exit}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
          </button>
          <div className="crosshair" />
          <PlayControls
            controls={controls}
            padPressedAt={padPressedAt}
            player={player}
            movementMode={movementMode}
            onMovementModeChange={setMovementMode}
          />
          <span className="sr-only" aria-live="polite">
            {log[0]?.message}
          </span>
        </section>
      )}
        <div className="workspace" hidden={playing}>
          <EditorPalette
            assets={world.assets}
            weather={world.weather}
            layer={layer}
            surface={surface}
            terrainTool={terrainTool}
            selectedAsset={selectedAsset}
            placingStart={placingStart}
            onSelectLayer={(next) => {
              setLayer(next);
              setPlacingStart(false);
            }}
            onSelectSurface={(next) => {
              setLayer("tiles");
              setPlacingStart(false);
              setSurface(next);
              setTerrainTool("surface");
            }}
            onSelectTerrainTool={(next) => {
              setLayer("tiles");
              setPlacingStart(false);
              setTerrainTool(next);
            }}
            onReroll={reroll}
            onWeatherChange={(weather) => change((w) => { w.weather = weather; })}
            onEditAsset={(asset) => {
              setLayer("symbols");
              setSelectedAsset(asset.id);
              setSelected(null);
              setPlacingStart(false);
              setEditingAsset(asset);
              setShowMaker(true);
            }}
            onToggleStart={() => {
              setLayer("symbols");
              setPlacingStart(!placingStart);
            }}
          />
          <EditorBoard
            world={world}
            actors={simulation.actors}
            derivation={derivation}
            feedback={feedback}
            canHold={layer === "symbols" && !placingStart}
            canUndo={history.current.length > 0}
            canRedo={future.current.length > 0}
            onPaint={paint}
            onEnd={() => { strokeBase.current = null; }}
            onSelectObject={setSelected}
            onUndo={undo}
            onRedo={redo}
          />
          <aside className="preview-panel" aria-label={t("배치 결과")}>
            <WeatherControls className="weather-mobile" value={world.weather}
              onChange={(weather) => change((w) => { w.weather = weather; })} />
            <div className="live-preview">
              {!playing && <Scene
                world={world}
                simulation={simulation}
                derivation={derivation}
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
