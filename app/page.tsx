"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { lazy, Suspense, type ComponentProps } from "react";
import { useLanguage, SceneLoading } from "@/components/whistle/Language";

import {
  starterWorld,
  createSimulation,
  stepSimulation,
  uid,
  type World,
  type Asset,
  type Placed,
  type Player,
  type Event,
  type Simulation,
} from "@/lib/world";
import { isHole, type TerrainTool } from "@/lib/tile";
import { downloadWorld } from "@/lib/sharing";
import { createTerrainWorld } from "@/lib/create-world";
import { useWorldDocument } from "@/components/whistle/useWorldDocument";
import { useGameAudio } from "@/components/whistle/useGameAudio";
import { editSound } from "@/lib/audio/game-parameters";
import { useWorldPersistence } from "@/components/whistle/useWorldPersistence";
import { useLiveWorldPublisher } from "@/components/whistle/useLiveWorldPublisher";
import { WeatherControls } from "@/components/whistle/WeatherControls";
import { EditorToolbar } from "@/components/whistle/EditorToolbar";
import { EditorPalette } from "@/components/whistle/EditorPalette";
import { EditorBoard } from "@/components/whistle/EditorBoard";
import { PlayControls } from "@/components/whistle/PlayControls";
import {
  generateTerrain,
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
export default function Home() {
  const { t } = useLanguage();
  const initialWorld = useMemo(starterWorld, []);
  const [selectedAsset, setSelectedAsset] = useState("circle"),
    [selected, setSelected] = useState<string | null>(null),
    [placingStart, setPlacingStart] = useState(false);
  const [simulation, setSimulation] = useState<Simulation>(() =>
      createSimulation(initialWorld),
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
  const simulationRef = useRef(simulation),
    player = useRef<Player>({ ...initialWorld.start, yaw: 0 }),
    controls = useRef(new Set<string>()),
    padPressedAt = useRef(new Map<string, number>()),
    file = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  simulationRef.current = simulation;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const audio = useGameAudio(notify);
  const resetSimulation = useCallback((w: World) => {
    audio.reset();
    const next = createSimulation(w);
    simulationRef.current = next;
    setSimulation(next);
    setLog([]);
    player.current = { ...w.start, yaw: 0 };
  }, [audio]);
  const {
    world, getWorld, deriveWorld, feedback, canUndo, canRedo,
    commit: updateWorld, edit: change, load: loadDocument,
    undo: undoDocument, redo: redoDocument, paint: paintDocument, endStroke,
  } = useWorldDocument(initialWorld, resetSimulation);
  const derivation = useMemo(
    () => deriveWorld(world, simulation.actors),
    [deriveWorld, world, simulation.actors],
  );
  useEffect(() => {
    if (!world.assets.some((a) => a.id === selectedAsset)) {
      setSelectedAsset(world.assets[0]?.id ?? "");
      setPlacingStart(false);
    }
  }, [world.assets, selectedAsset]);
  const handleLoad = useCallback((incoming: World, beforeUpgrade: World) => {
    audio.stop();
    loadDocument(incoming, beforeUpgrade);
    setSelectedAsset(incoming.assets[0].id);
    setSelected(null);
    setPlaying(false);
  }, [audio, loadDocument]);
  const handleImport = useCallback((imported: World) => {
    updateWorld(imported);
    setSelectedAsset(imported.assets[0].id);
    setSelected(null);
  }, [updateWorld]);
  const { ready, saveStatus, resumeAutosave, importFile: loadFile } = useWorldPersistence({
    world, onLoad: handleLoad, onImport: handleImport, notify,
  });
  useLiveWorldPublisher(world, ready);
  const reset = useCallback((w: World = getWorld()) => {
    resetSimulation(w);
  }, [getWorld, resetSimulation]);
  const undo = () => {
    if (undoDocument()) setSelected(null);
  };
  const redo = () => {
    if (redoDocument()) setSelected(null);
  };
  const step = useCallback(() => {
    if (player.current.falling) return;
    const next = stepSimulation(
      getWorld(),
      simulationRef.current,
      player.current,
    );
    simulationRef.current = next;
    setSimulation(next);
    if (next.events.length) {
      setLog((prev) => [...next.events, ...prev].slice(0, 12));
      next.events.filter((e) => e.action === "sound").forEach((event) => audio.event(event, player.current));
    }
  }, [audio, getWorld]);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(step, 700);
    return () => clearInterval(interval);
  }, [playing, step]);
  const enter = () => {
    reset();
    audio.play();
    setPlaying(true);
    setPlayKey((k) => k + 1);
    controls.current.clear();
    setMovementMode("walk");
  };
  const exit = () => {
    audio.stop();
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
    const before = getWorld();
    paintDocument(cells, erase, { layer, surface, terrainTool, selectedAsset });
    const after = getWorld();
    if (before !== after) {
      const sound = editSound(before, after, cells, deriveWorld(after));
      if (sound) audio.edit(sound);
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
      await loadFile(f);
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const newWorld = () => {
    const next = createTerrainWorld();
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
            onAudioFrame={audio.movement}
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
            canUndo={canUndo}
            canRedo={canRedo}
            onPaint={paint}
            onEnd={endStroke}
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
