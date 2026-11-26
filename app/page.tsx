"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { lazy, Suspense, type ComponentProps } from "react";
import { useLanguage, SceneLoading } from "@/components/whistle/Language";

import {
  createSimulation,
  stepSimulation,
  type World,
  type Asset,
  type Player,
  type Event,
  type Simulation,
} from "@/lib/world";
import { emptySymbol, initializeWorkshop, completeSymbol, refillSymbols, TURN_HINT } from "@/lib/workshop";
import { uncountedTiles, TURN_TILE_HINT, TURN_TILE_LIMIT } from "@/lib/turn-tiles";
import { TurnBar, useWorkshopTurn } from "@/components/whistle/TurnBar";
import type { TerrainTool } from "@/lib/tile";
import { downloadWorld } from "@/lib/sharing";
import { useWorldDocument } from "@/components/whistle/useWorldDocument";
import { SoundMaker } from "@/components/whistle/SoundMaker";
import { contentKind, contentLimitMessage, MAX_CONTENT_COUNT, MAX_LIBRARY_SIZE, validateContentCounts } from "@/lib/content-limits";
import { useGameAudio } from "@/components/whistle/useGameAudio";
import { editSound } from "@/lib/audio/game-parameters";
import { useWorldPersistence } from "@/components/whistle/useWorldPersistence";
import { browserWorldStore } from "@/lib/browser-world";
import { useLiveWorldPublisher } from "@/components/whistle/useLiveWorldPublisher";
import { EditorToolbar } from "@/components/whistle/EditorToolbar";
import { EditorPalette } from "@/components/whistle/EditorPalette";
import { EditorBoard } from "@/components/whistle/EditorBoard";
import { PlayControls } from "@/components/whistle/PlayControls";
import { DebugOverlay } from "@/components/whistle/DebugOverlay";
import type { MeetingSession } from "@/components/whistle/ConnectedWorld";
import { MeetingOverlay, meetingVisuals } from "@/components/whistle/MeetingTools";
import { createMeetingWorld, fixMeetingStart, withLocalMeetingWorld, meetingGlobal, meetingLocal, meetingOwner, meetingReturnPosition, authoredMaterialCount, MEETING_MATERIAL_LIMIT, MEETING_MATERIAL_MESSAGE } from "@/lib/meeting";
import { useMeetingWhistle } from "@/components/whistle/useMeetingWhistle";
import { portalWorld } from "@/lib/portal-protocol";
import {
  floorHeight,
  type Surface,
} from "@/lib/terrain";
import {
  Dialog,
  AssetMaker,
} from "@/components/whistle/Dialogs";
const LazyScene = lazy(() => import("@/components/whistle/Scene"));
function Scene(props: ComponentProps<typeof LazyScene>) {
  return <Suspense fallback={<SceneLoading />}><LazyScene {...props} /></Suspense>;
}
export default function Home({meeting}:{meeting:MeetingSession}) {
  const { t } = useLanguage();
  const initialWorld = useMemo(() => initializeWorkshop(structuredClone(meeting.view.ownWorld)), []);
  const turn = useWorkshopTurn(meeting);
  const initialPlayer = useMemo(() => ({...meetingGlobal(0,initialWorld.start),yaw:0}), []);
  const receivedMaterials = useRef(new Set(meeting.view.received ?? []));
  const serverTiles = turn.canPlace && meeting.enabled ? meeting.presence.turn?.tiles : undefined;
  const localTiles = useMemo(() => new Set<number>(), [meeting.view.id, meeting.presence.turn?.partner, turn.endsAt, meeting.rejected]);
  const turnTiles = serverTiles && { existing: serverTiles.existing, added: [...new Set([...serverTiles.added, ...localTiles])] };
  const browserStorage = useMemo(() => browserWorldStore(meeting.key,meeting.documentId),[meeting.key,meeting.documentId]);
  const [selected, setSelected] = useState<string | null>(null),
    [placingAsset, setPlacingAsset] = useState<string | null>(null),
    [contentType, setContentType] = useState<"image" | "text" | "sound">("image"),
    [placingStart, setPlacingStart] = useState(false);
  const [simulation, setSimulation] = useState<Simulation>(() =>
      createSimulation(initialWorld),
    ),
    [playing, setPlaying] = useState(false),
    [debugVisible, setDebugVisible] = useState(false),
    [log, setLog] = useState<Event[]>([]),
    [toast, setToast] = useState(""),
    [showMaker, setShowMaker] = useState(false),
    [editingAsset, setEditingAsset] = useState<Asset | undefined>(),
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
  const [spawn, setSpawn] = useState<Player>(initialPlayer);
  const [surface, setSurface] = useState<Surface>("soft"),
    [terrainTool, setTerrainTool] = useState<TerrainTool>("surface");
  const simulationRef = useRef(simulation),
    player = useRef<Player>(initialPlayer),
    controls = useRef(new Set<string>()),
    stick = useRef({ x: 0, y: 0 }),
    file = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  simulationRef.current = simulation;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const audio = useGameAudio(notify);
  const whistle = useMeetingWhistle(meeting, playing, player, audio.whistle);
  const meetingReset = useRef(meeting.view.reset.id);
  useLayoutEffect(() => {
    const reset=meeting.view.reset;
    if(reset.id!==meetingReset.current){
      meetingReset.current=reset.id;player.current={...reset.player};setSpawn({...reset.player});
      controls.current.clear();setMovementMode("walk");setPlayKey(k=>k+1);
    }else if(meeting.status!=="online"){
      const owner=meetingOwner(Math.round(player.current.x),Math.round(player.current.z));
      const gate=meeting.view.connections.find(c=>!c.retired&&c.x===(owner===1?12:owner===2?25:-1));
      if(gate){const next=meetingReturnPosition(gate,player.current.yaw,"disconnect");player.current=next;setSpawn(next);controls.current.clear();setPlayKey(k=>k+1);}
    }
  },[meeting.view.reset,meeting.status]);
  const resetSimulation = useCallback((w: World) => {
    audio.reset();
    const next = createSimulation(w);
    simulationRef.current = next;
    setSimulation(next);
    setLog([]);

  }, [audio]);
  const {
    world, getWorld, deriveWorld, feedback, canUndo, canRedo,
    commit: updateWorld, edit: change, load: loadDocument,
    undo: undoDocument, redo: redoDocument, paint: paintDocument, endStroke, moveSymbol: moveDocumentSymbol, receiveAssets, syncConnectionFootings,
  } = useWorldDocument(initialWorld, resetSimulation);
  useEffect(() => { endStroke(); }, [turn.canPlace, turn.endsAt, endStroke]);
  useEffect(() => {
    if (!meeting.rejected) return;
    const incoming = structuredClone(meeting.rejected.world);
    const current = getWorld();
    incoming.assets = incoming.assets.map(a => ({...a, originalImage:current.assets.find(b => b.id === a.id && b.image === a.image)?.originalImage}));
    loadDocument(incoming, incoming);
    notify(meeting.rejected.message);
  }, [meeting.rejected, getWorld, loadDocument, notify]);
  const sharedIds = useMemo(() => new Set([
    ...(meeting.view.materials.map(a => a.id) ?? []),...world.assets.filter(a=>a.received).map(a=>a.id),
  ]), [meeting.view.materials,world.assets]);
  const ownActors = simulation.actors;
  const derivation = useMemo(
    () => deriveWorld(world, ownActors),
    [deriveWorld, world, ownActors],
  );
  const activeWorld = useMemo(()=>withLocalMeetingWorld(meeting.view,world,meeting.status==="online"),[meeting.view,world,meeting.status]);
  const baseSimulation = useMemo(() => createSimulation(activeWorld), [activeWorld]);
  const [playState,setPlayState]=useState<{world:World;simulation:Simulation}|null>(null);
  const activeSimulation=playState?.world===activeWorld?playState.simulation:baseSimulation;
  const playingState=useRef({world:activeWorld,simulation:activeSimulation});
  playingState.current={world:activeWorld,simulation:activeSimulation};
  const activeDerivation = useMemo(() => playing?deriveWorld(activeWorld, activeSimulation.actors):derivation,
    [playing,deriveWorld, activeWorld, activeSimulation.actors,derivation]);
  useEffect(()=>{
    if(!playing)return;
    const timer=setInterval(()=>{
      const current=playingState.current;
      if(player.current.falling||!current.world.rules.some(rule=>rule.enabled))return;
      const next=stepSimulation(current.world,current.simulation,player.current);
      playingState.current={world:current.world,simulation:next};setPlayState(playingState.current);
      if(next.events.length)setLog(previous=>[...next.events,...previous].slice(0,12));
    },700);
    return()=>clearInterval(timer);
  },[playing]);
  const symbols = world.assets.filter(asset => asset.image || asset.text?.trim() || asset.sound);
  const nextSoundName = String(Math.max(0, ...world.assets.filter(a => a.sound && /^[1-9]\d{0,5}$/.test(a.name)).map(a => Number(a.name))) + 1);
  const activeAsset = symbols.find(asset => asset.id === placingAsset)?.id ?? null;
  const editSymbol = (asset: Asset, objectId: string | null = null) => {
    setPlacingStart(false); setSelected(objectId);
    setEditingAsset({ ...asset });
    setContentType(asset.sound ? "sound" : asset.text !== undefined ? "text" : asset.prompt?.kind ?? "image");
    setShowMaker(true);
  };
  const openSymbolAt = (i: number, objectId?: string) => {
    const object = world.objects.filter(object => object.x === i % world.size && object.z === Math.floor(i / world.size) && (!objectId || object.id === objectId)).at(-1);
    const asset = world.assets.find(asset => asset.id === object?.asset);
    if (object && asset && (asset.image || asset.text?.trim() || asset.sound || emptySymbol(asset))) editSymbol(asset, object.id);
  };
  const handleLoad = useCallback((incoming: World, beforeUpgrade: World) => {
    audio.stop();
    if(incoming.size===12){fixMeetingStart(incoming);fixMeetingStart(beforeUpgrade);}
    incoming.connectionFootings=[];beforeUpgrade.connectionFootings=[];
    receivedMaterials.current=new Set([...(incoming.receivedMaterialIds??[]),...incoming.assets.filter(a=>a.received).map(a=>a.id)]);
    initializeWorkshop(incoming);
    loadDocument(incoming, beforeUpgrade);
    setSelected(null); setPlacingAsset(null); setShowMaker(false);
    setPlaying(false);
  }, [audio, loadDocument]);
  const allowTurnTiles = (next: World) => {
    if (!turnTiles) return true;
    const added = uncountedTiles(next, turnTiles);
    if (turnTiles.added.length + added.length > TURN_TILE_LIMIT) {
      notify(TURN_TILE_HINT);
      return false;
    }
    if (added.length) {
      for (const i of added) localTiles.add(i);
      turnTiles.added.push(...added);
      meeting.send({type:"publish",world:portalWorld(next),received:[...receivedMaterials.current]});
    }
    return true;
  };
  const handleImport = (imported: World) => {
    if (!turn.canPlace) { notify(TURN_HINT); return; }
    if(imported.size!==12){notify("12×12 맵을 사용합니다.");return;}
    if (authoredMaterialCount(imported, sharedIds) > MEETING_MATERIAL_LIMIT) { notify(MEETING_MATERIAL_MESSAGE); return; }
    imported.connectionFootings=[];
    const next = initializeWorkshop(fixMeetingStart(imported));
    if (!allowTurnTiles(next)) return;
    receivedMaterials.current=new Set([...(imported.receivedMaterialIds??[]),...imported.assets.filter(a=>a.received).map(a=>a.id)]);
    updateWorld(next);
    setSelected(null); setPlacingAsset(null); setShowMaker(false);
  };
  const { ready, loading, saveStatus, resumeAutosave, importFile: loadFile } = useWorldPersistence({
    world, onLoad: handleLoad, onImport: handleImport, notify, libraryLimit: MAX_LIBRARY_SIZE,
    storage:browserStorage,fallbackWorld:initialWorld,
  });
  useLiveWorldPublisher(world,ready);
  useEffect(()=>{
    if(!ready)return;
    if(!meeting.enabled)syncConnectionFootings([]);
    else if(meeting.view.documentReady)
      syncConnectionFootings(meeting.view.ownWorld.connectionFootings);
  },[ready,meeting.enabled,meeting.status,meeting.view.documentReady,meeting.view.ownWorld.connectionFootings,syncConnectionFootings]);
  useEffect(() => {
    if(!ready || !meeting.enabled || meeting.status!=="online" || !meeting.view.recipients.length)return;
    const incoming = meeting.view.materials.filter(a => !receivedMaterials.current.has(a.id)) ?? [];
    if (!incoming.length) return;
    for (const asset of receiveAssets(incoming)) receivedMaterials.current.add(asset.id);
  }, [meeting.view.materials, meeting.view.recipients.length, meeting.enabled, meeting.status, receiveAssets, ready]);
  useEffect(() => {
    if(!ready || meeting.status!=="online")return;
    const send=()=>meeting.send({type:"publish",world:portalWorld(getWorld()),received:[...receivedMaterials.current]});
    const timer=setTimeout(send,100);
    window.addEventListener("pagehide",send);
    return()=>{clearTimeout(timer);window.removeEventListener("pagehide",send);};
  },[world,ready,meeting.send,meeting.status,getWorld]);
  const blocked = () => notify(TURN_HINT);
  const canPlaceNow = () => {
    const current = meeting.enabled ? meeting.presence.turn : undefined;
    return !current || meeting.status === "online" && current.owner === meeting.view.id &&
      meeting.turnClock.server + performance.now() - meeting.turnClock.local < current.endsAt;
  };
  const undo = () => {
    if (!canPlaceNow()) { blocked(); return; }
    if (undoDocument(allowTurnTiles)) setSelected(null);
  };
  const redo = () => {
    if (!canPlaceNow()) { blocked(); return; }
    if (redoDocument(allowTurnTiles)) setSelected(null);
  };
  const enter = () => {
    setPlayState(null);
    setDebugVisible(new URLSearchParams(location.search).has("debug"));
    meeting.send({type:"publish",world:portalWorld(getWorld()),received:[...receivedMaterials.current]});
    const p=player.current;
    const next=floorHeight(activeWorld,p.x,p.z,deriveWorld(activeWorld).structures)!==null?{...p,falling:false}:{...activeWorld.start,yaw:0};
    setSpawn(next);player.current=next;audio.play();setPlaying(true);setPlayKey(k=>k+1);
    controls.current.clear();setMovementMode("walk");
    meeting.position({...next,grounded:true},true);
  };
  const exit = () => {
    meeting.position({...player.current,grounded:!!player.current.grounded},false);
    audio.stop();setPlaying(false);controls.current.clear();setMovementMode("walk");
  };
  useEffect(() => {
    if (!playing) return;
    const playShortcut = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
      if (e.code !== "Backquote" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest("input, textarea, select"))) return;
      e.preventDefault();
      setDebugVisible(visible => !visible);
    };
    window.addEventListener("keydown", playShortcut);
    return () => window.removeEventListener("keydown", playShortcut);
  }, [playing]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const paint = (cells: number[], erase: boolean) => {
    if (!canPlaceNow()) { endStroke(); blocked(); return; }
    const before = getWorld();
    const kind = contentKind(before.assets.find(a => a.id === activeAsset));
    if (!erase && kind) {
      const count = before.objects.filter(o => contentKind(before.assets.find(a => a.id === o.asset)) === kind).length;
      const added = cells.filter(i => !before.objects.some(o => o.asset === activeAsset && o.x === i % before.size && o.z === Math.floor(i / before.size))).length;
      if (count + added > MAX_CONTENT_COUNT) notify(contentLimitMessage[kind]);
    }
    const limited = paintDocument(cells, erase, { layer: activeAsset ? "symbols" : "tiles", assetId: activeAsset ?? undefined, surface, terrainTool, turnTiles }, allowTurnTiles);
    if (limited) notify(TURN_TILE_HINT);
    const after = getWorld();
    if (before !== after) {
      const sound = editSound(before, after, cells, deriveWorld(after));
      if (sound) audio.edit(sound);
    }
  };
  const saveAsset = (asset: Asset) => {
    if (!world.assets.some(a=>a.id===asset.id) && world.assets.length >= MAX_LIBRARY_SIZE) { notify("재료 목록이 가득 찼습니다. 사용하지 않는 재료를 삭제해 주세요."); return; }
    if ((!world.assets.some(a => a.id === asset.id) || emptySymbol(world.assets.find(a => a.id === asset.id))) && authoredMaterialCount(world, sharedIds) >= MEETING_MATERIAL_LIMIT) {
      notify(MEETING_MATERIAL_MESSAGE); return;
    }
    if ((!asset.image && !asset.sound) || (contentType === "text" && !asset.text?.trim())) return;
    if (asset.sound) {
      asset = { ...asset, name: asset.name.trim().slice(0, 12) || nextSoundName };
    }
    change(w => {
      const previous = w.assets.find(a => a.id === asset.id);
      const index = w.assets.findIndex(a => a.id === asset.id);
      if (index >= 0) w.assets[index] = { ...asset, glyphColor: w.assets[index].glyphColor, prompt: previous?.prompt, ...(w.assets[index].received?{received:true}:{}) };
      else w.assets.push({ ...asset, glyphColor: undefined });
      const object = w.objects.find(o => o.id === selected);
      if (object) { object.asset = asset.id; object.scale = asset.defaultScale ?? 1; }
      else if (editingAsset) {
        for (const placed of w.objects) if (placed.asset === asset.id) placed.scale = asset.defaultScale ?? 1;
      }
      if (previous) completeSymbol(w, previous, selected ?? undefined);
      validateContentCounts(w, MAX_LIBRARY_SIZE);
    });
    if (meeting.status === "online") meeting.send({type:"publish",world:portalWorld(getWorld()),received:[...receivedMaterials.current]});
    setShowMaker(false); setEditingAsset(undefined); setSelected(null); setPlacingAsset(null);
  };
  const saveFile = () => {
    try { downloadWorld(world); }
    catch { notify("저장할 수 없습니다."); }
  };
  const deleteSymbol = () => {
    if (!editingAsset) return;
    if (!canPlaceNow()) { blocked(); return; }
    change(w => {
      if (selected) w.objects = w.objects.filter(o => o.id !== selected);
      else {
        w.objects = w.objects.filter(o => o.asset !== editingAsset.id);
        w.assets = w.assets.filter(a => a.id !== editingAsset.id);
        w.rules = w.rules.filter(r => ![r.subject, r.source, r.replacement].includes(editingAsset.id));
      }
      refillSymbols(w);
    });
    setShowMaker(false); setEditingAsset(undefined); setSelected(null); setPlacingAsset(null);
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
    const next = createMeetingWorld();
    receivedMaterials.current.clear();
    loadDocument(next,next);
    player.current={...meetingGlobal(0,next.start),yaw:0};setSpawn(player.current);
    meetingReset.current=0;
    meeting.restart(next);
    resumeAutosave();
    setSelected(null); setPlacingAsset(null); setPlacingStart(false);
    setNewDialog(false);
  };
  if(loading)return <SceneLoading />;
  return (
    <main className={`studio ${playing ? "playing" : ""}${turn.canPlace ? "" : " placement-waiting"}`}
      data-meeting-id={meeting.view.id} data-meeting-slot={meeting.view.slot} data-meeting-status={meeting.status} data-meeting-joined={meeting.view.joined.length}>
      <EditorToolbar
        playing={playing}
        saveStatus={saveStatus}
        onlineCount={meeting.presence.onlineCount ?? Math.max(1,meeting.presence.peers.filter(p=>p.online).length)}
        multiplayerEnabled={meeting.enabled}
        onToggleMultiplayer={() => meeting.setMultiplayer(!meeting.enabled,getWorld())}
        connectionStatus={meeting.status}
        makeButton={makeButton}
        onEnter={enter}
        onExit={exit}
        onNew={() => setNewDialog(true)}
        onImport={() => file.current?.click()}
        onSave={saveFile}
      />
      {playing && (
        <section className="play-shell">
          <Scene
            key={playKey}
            world={activeWorld}
            simulation={activeSimulation}
            derivation={activeDerivation}
            mode="play"
            debugVisible={debugVisible}
            onPlayer={(p) => {player.current = p;meeting.position({...p,grounded:!!p.grounded},true);}}
            onAudioFrame={frame => audio.movement(frame, activeWorld, activeSimulation.actors, activeDerivation)}
            controls={controls}
            stick={stick}
            onControlsReset={() => setMovementMode("walk")}
            initialPlayer={spawn}
            meeting={meetingVisuals(meeting)}
          />
          <button className="play-return" aria-label={t("만들기로 돌아가기")} onClick={exit}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle className="return-outline" cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="8" /></svg>
          </button>
          <button className="meeting-whistle" aria-label="휘슬" disabled={!whistle.enabled}
            onKeyDown={event => { if (event.repeat) event.preventDefault(); }} onClick={whistle.blow}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
          </button>
          <div className="crosshair" />
          <DebugOverlay visible={debugVisible} audio={audio} getWorld={() => activeWorld} derivation={activeDerivation} />
          <PlayControls
            key={`controls-${playKey}`}
            controls={controls}
            stick={stick}
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
            weather={world.weather} timeOfDay={world.timeOfDay} surface={surface} terrainTool={terrainTool} placingStart={placingStart}
            symbols={symbols} selectedSymbol={activeAsset ?? undefined}
            sharedSymbolIds={sharedIds}
            startLocked
            extraTools={meeting.view.pendingMaterials > 0 ? <small role="status">보관 공간이 부족해 재료 {meeting.view.pendingMaterials}개가 대기 중입니다.</small> : undefined}
            onSelectSurface={next => { setPlacingStart(false); setPlacingAsset(null); setSurface(next); setTerrainTool("surface"); }}
            onSelectTerrainTool={next => { setPlacingStart(false); setPlacingAsset(null); setTerrainTool(next); }}
            onTimeOfDayChange={timeOfDay => change(w => { w.timeOfDay = timeOfDay; })}
            onWeatherChange={weather => change(w => { w.weather = weather; })}
            canPlace={turn.canPlace}
            onBlocked={blocked}
            onSelectSymbol={id => { setPlacingStart(false); setPlacingAsset(activeAsset === id ? null : id); }}
            onEditSymbol={id => { const asset = world.assets.find(asset => asset.id === id); if (asset) editSymbol(asset); }}
            onToggleStart={() => { setPlacingAsset(null); setPlacingStart(!placingStart); }}
          />
          <EditorBoard
            world={world}
            actors={ownActors}
            derivation={derivation}
            feedback={feedback}
            placingAsset={activeAsset}
            onOpenSymbol={openSymbolAt}
            placingStart={placingStart}
            canHold={!placingStart}
            canUndo={canUndo && turn.canPlace}
            canRedo={canRedo && turn.canPlace}
            onUndo={undo}
            onRedo={redo}
            canPlace={turn.canPlace}
            onBlocked={blocked}
            turnBar={<TurnBar {...turn} tilesLeft={turnTiles ? TURN_TILE_LIMIT - turnTiles.added.length : undefined} />}
            onMoveSymbol={(id, index) => {
              if (!canPlaceNow()) { blocked(); return; }
              endStroke(); moveDocumentSymbol(id, index);
            }}
            onPaint={paint}
            onEnd={endStroke}
            overlay={<MeetingOverlay meeting={meeting} />}
          />
          <aside className="preview-panel" aria-label={t("배치 결과")}>
            <div className="live-preview">
              {!playing && <Scene
                world={world}
                simulation={simulation}
                derivation={derivation}
                mode="overview"
                feedback={feedback}
                    meeting={meetingVisuals(meeting,true)}
              />}
              <button onClick={enter} aria-label={t("들어가기")}>
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
      {showMaker && contentType === "sound" && <SoundMaker
        asset={editingAsset} defaultName={nextSoundName} onSave={saveAsset}
        placement={!!selected}
        deleteDisabled={!turn.canPlace}
        onDelete={editingAsset && !emptySymbol(editingAsset) ? deleteSymbol : undefined}
        onClose={() => { setShowMaker(false); setEditingAsset(undefined); setSelected(null); }}
      />}
      {showMaker && contentType !== "sound" && (
        <AssetMaker
          asset={editingAsset}
          contentType={contentType}
          onSave={saveAsset}
          placement={!!selected}
          deleteDisabled={!turn.canPlace}
          onDelete={editingAsset && !emptySymbol(editingAsset) ? deleteSymbol : undefined}
          onClose={() => {
            setShowMaker(false);
            setEditingAsset(undefined); setSelected(null);
          }}
        />
      )}
      {newDialog && (
        <Dialog title={t("다시 시작")} onClose={() => setNewDialog(false)}>
          <p>{t("현재 작업이 삭제됩니다.")}</p>
          <div className="new-actions">
            <button onClick={saveFile}>
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
          {t("저장 공간이 부족합니다.")}{" "}
          <button onClick={saveFile}>{t("파일 저장")}</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {t(toast)}
        </div>
      )}
      {meeting?.error && <div className="toast" role="status">{meeting.error}</div>}
    </main>
  );
}
