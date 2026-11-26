"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Actor, World } from "@/lib/world";
import type { PlacementFeedback } from "@/lib/placement-feedback";
import type { WorldDerivation } from "@/lib/world-derivation";
import { tileAt, SURFACES, LEVEL } from "@/lib/terrain";
import { WATER_INSET } from "@/lib/water";
import { isGap, isHole, isVoid } from "@/lib/tile";
import { PaintGrid } from "./PaintGrid";
import { EnvironmentTile, environmentTileKind } from "./EnvironmentTile";
import { HoleGlyph } from "./HoleGlyph";
import { EnvironmentEffects } from "./EnvironmentEffects";
import { effectRegions } from "@/lib/effect-regions";
import { useEffectFeedback } from "./useEffectFeedback";
import { SoundGlyph } from "./SoundGlyph";
import { soundRangeAt } from "@/lib/audio/sound-range";
import { SiteGlyph } from "./SiteGlyph";
import { useLanguage } from "./Language";
import { emptySymbol } from "@/lib/workshop";
import type { WorldPortal } from "../../lib/portals.ts";

type Props = {
  world: World;
  actors: Actor[];
  derivation: WorldDerivation;
  feedback: PlacementFeedback | null;
  canHold: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPaint: (cells: number[], erase: boolean) => void;
  onEnd: () => void;
  placingAsset: string | null;
  placingStart: boolean;
  onOpenSymbol: (index: number, objectId?: string) => void;
  portals?: WorldPortal[];
  overlay?: ReactNode;
  canPlace?: boolean;
  onMoveSymbol?: (id: string, index: number) => void;
  onBlocked?: () => void;
  turnBar?: ReactNode;
};

export function EditorBoard({
  world, actors, derivation, feedback, canHold, canUndo, canRedo,
  onPaint, onEnd, placingAsset, placingStart, onOpenSymbol, onUndo, onRedo,
  portals = [],
  overlay,
  canPlace = true, onMoveSymbol, onBlocked, turnBar,
}: Props) {
  const { t } = useLanguage();
  const { structures, environment } = derivation;
  const startCell = world.start.z * world.size + world.start.x;
  const regions = useMemo(() => effectRegions(environment), [environment]);
  const effectFeedback = useEffectFeedback(regions, world.size, feedback?.id ?? null);
  const effectCells = new Set(effectFeedback.markers.map(region => region.anchor));
  const environmentLabels = (i: number) => {
    const c = environment.cells[i];
    return [
      c.grass > 0 ? t("풀") : "",
      c.tree ? t("나무") : "",
      c.water !== null ? t("물") : "",
      c.fog > 0.05 ? t("안개") : "",
      Math.hypot(c.windX, c.windZ) > 0.1 ? t("바람") : "",
      c.light < 0.7 ? t("그늘") : "",
      c.dust ? t("먼지") : "",
      c.flicker ? t("깜박임") : "",
      c.lift ? t("부유") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  return (
    <section className="canvas-panel">
      <div className="canvas-history history-tools">
        <button aria-label={t("되돌리기")} disabled={!canUndo} onClick={onUndo}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
          </svg>
        </button>
        <button aria-label={t("다시 실행")} disabled={!canRedo} onClick={onRedo}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path transform="translate(24 0) scale(-1 1)" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
          </svg>
        </button>
      </div>
      <div className="canvas-area">
        <PaintGrid
          size={world.size}
          overlay={<>
            {overlay}
            <EnvironmentEffects regions={effectFeedback.markers} size={world.size} onAnimationEnd={effectFeedback.finish} />
            <div className="portal-map-layer">{portals.map(portal => <span key={portal.id} className="portal-map-marker" role="img"
              style={{ left: `${(portal.x + .5) / world.size * 100}%`, top: `${(portal.z + .5) / world.size * 100}%` }}
              aria-label={`${portal.label} ${t("포털")}`} data-map-portal={portal.id}>
              <span className="portal-glyph" aria-hidden="true" />
            </span>)}</div>
          </>}
          occupied={(i) =>
            world.objects.some(
              (o) =>
                o.x === i % world.size &&
                o.z === Math.floor(i / world.size) && (!placingAsset || o.asset === placingAsset),
            )
          }
          canHold={canHold}
          onPaint={onPaint}
          onEnd={onEnd}
          onHold={onOpenSymbol}
          cellClass={(i) => {
            const tile = tileAt(
              world,
              i % world.size,
              Math.floor(i / world.size),
            )!;
            const c = environment.cells[i];
            const sound = world.assets.find(a => a.id === placingAsset)?.sound;
            const inSoundRange = sound && world.objects.some(o => o.asset === placingAsset && Math.hypot(o.x - i % world.size, o.z - Math.floor(i / world.size)) < soundRangeAt(environment, o.x, o.z));
            return `${inSoundRange ? "sound-range" : ""} surface-${effectCells.has(i) || environmentTileKind(c) ? "plain" : tile.surface} level-${c.water === null ? tile.height : 0} ${isVoid(tile) ? "tile-empty" : isHole(tile) ? "tile-void" : "tile-ground"} ${effectCells.has(i) ? "has-effect" : ""} ${c.grass ? "has-grass" : ""} ${c.water !== null ? "has-water" : ""} ${c.tree ? "has-tree" : ""} ${c.fog > 0.05 ? "has-fog" : ""}`;
          }}
          label={(i) => {
            const x = i % world.size,
              z = Math.floor(i / world.size),
              tile = tileAt(world, x, z)!;
            const objects = world.objects.filter(
              (o) => o.x === x && o.z === z,
            );
            const water = environment.cells[i].water;
            const height = water === null ? tile.height : Math.round((water + WATER_INSET) / LEVEL);
            return `${String.fromCharCode(65 + x)}${z + 1} ${isVoid(tile) ? t("허공") : isHole(tile) ? t("꺼짐") : `${t("높이")} ${height} ${t(SURFACES.find((s) => s.id === tile.surface)!.name)}`} ${objects.map(object => world.assets.find(a => a.id === object.asset)?.name).filter(Boolean).join(" · ")}${i === startCell ? " " + t("시작점") : ""} ${environmentLabels(i)}`;
          }}
          renderCell={(i) => {
            const x = i % world.size,
              z = Math.floor(i / world.size),
              tile = tileAt(world, x, z)!;
            const cellActors = actors.filter(
              (a) => a.x === x && a.z === z && !a.removed && world.assets.some(asset => asset.id === a.asset && (asset.image || asset.text?.trim() || asset.sound || emptySymbol(asset))),
            );
            const actor = cellActors[0];
            const generated = structures.filter(
              (t) => t.x === x && t.z === z,
            );
            const conditions = environment.cells[i];
            const height = conditions.water === null ? tile.height : Math.round((conditions.water + WATER_INSET) / LEVEL);
            const reaction = feedback?.cells.find((c) => c.index === i);
            return (
              <>
                <span
                  className="environment-light"
                  aria-hidden="true"
                  style={{ opacity: (1 - conditions.light) * 0.2 }}
                />
                {!isVoid(tile) && !effectCells.has(i) && (isHole(tile)
                  ? <HoleGlyph className="result-tile result-hole" />
                  : <EnvironmentTile cell={conditions} />)}
                {height !== 0 && !isGap(tile) && (
                  <span className="tile-height">{height}</span>
                )}
                {!effectCells.has(i) && generated.map((t) => (
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
                  >
                    {t.kind === "stairs" && <svg viewBox="0 0 32 32" aria-hidden="true">
                      <path d="M11 8V24M21 8V24M11 12H21M11 16H21M11 20H21"
                        fill="none" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>}
                  </span>
                ))}
                {cellActors.map((placed, layer) => {
                  const asset = world.assets.find(a => a.id === placed.asset)!;
                  const empty = emptySymbol(asset);
                  const type = asset.sound ? "sound" : asset.text !== undefined ? "text" : asset.prompt?.kind ?? "image";
                  const kind = type === "text" ? "peak" : "cluster";
                  const offset = (layer - (cellActors.length - 1) / 2) * Math.min(4, 12 / cellActors.length);
                  const color = empty ? "#777777" : asset.glyphColor ?? asset.color;
                  return <SymbolMarker key={placed.id} id={placed.id} index={i} size={world.size} offset={offset} layer={layer}
                    empty={empty} kind={type} label={`${t(asset.prompt?.title ? "장면 제목" : type === "text" ? "텍스트" : type === "sound" ? "사운드" : "이미지")} ${t(empty ? "입력" : "편집")}`}
                    canPlace={canPlace} onOpen={() => onOpenSymbol(i, placed.id)} onMove={onMoveSymbol} onBlocked={onBlocked}>
                    {type === "sound" ? <SoundGlyph color={color} filled={!empty} /> : <SiteGlyph kind={kind} filled={!empty} color={color} />}
                  </SymbolMarker>;
                })}
                {!!actor?.marks.length && (
                  <span className="cell-mark">{actor.marks[0]}</span>
                )}
                {i === startCell && <span className="start-marker" aria-hidden="true" />}
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
      {turnBar}
    </section>
  );
}

function SymbolMarker({ id, index, size, offset, layer, empty, kind, label, canPlace, onOpen, onMove, onBlocked, children }: {
  id: string; index: number; size: number; offset: number; layer: number; empty: boolean; kind: string; label: string;
  canPlace: boolean; onOpen: () => void; onMove?: (id: string, index: number) => void; onBlocked?: () => void; children: ReactNode;
}) {
  const gesture = useRef<{x:number;y:number;moved:boolean;blocked:boolean} | null>(null);
  const [dragging, setDragging] = useState(false);
  return <span className={`generated-site symbol-marker${empty ? " empty-symbol" : ""}${dragging ? " symbol-dragging" : ""}`}
    role="button" tabIndex={0} aria-label={label} data-symbol-site={id} data-symbol-kind={kind} data-empty-symbol={empty}
    style={{marginLeft:offset,marginTop:-offset,zIndex:5+layer}}
    onPointerDown={e => {
      e.stopPropagation(); if(e.button!==0)return;
      gesture.current={x:e.clientX,y:e.clientY,moved:false,blocked:false}; e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      e.stopPropagation(); const g=gesture.current; if(!g || Math.hypot(e.clientX-g.x,e.clientY-g.y)<7)return;
      g.moved=true;
      if(!canPlace){if(!g.blocked)onBlocked?.();g.blocked=true;return;}
      setDragging(true);
    }}
    onPointerUp={e => {
      e.stopPropagation(); const g=gesture.current; gesture.current=null;setDragging(false);if(!g)return;
      if(!g.moved){onOpen();return;}
      if(!canPlace){if(!g.blocked)onBlocked?.();return;}
      const rect=e.currentTarget.closest(".world-grid")!.getBoundingClientRect();
      const x=Math.floor((e.clientX-rect.left)/rect.width*size),z=Math.floor((e.clientY-rect.top)/rect.height*size);
      if(x>=0&&z>=0&&x<size&&z<size)onMove?.(id,z*size+x);
    }}
    onPointerCancel={e=>{e.stopPropagation();gesture.current=null;setDragging(false);}}
    onLostPointerCapture={()=>{gesture.current=null;setDragging(false);}}
    onClick={e=>{e.stopPropagation();if(e.detail===0)onOpen();}}
    onKeyDown={e=>{
      if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();onOpen();}
      const delta:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-size,ArrowDown:size};
      if(e.altKey&&e.key in delta){e.preventDefault();e.stopPropagation();if(!canPlace){onBlocked?.();return;}
        if(e.key==="ArrowLeft"&&index%size===0||e.key==="ArrowRight"&&index%size===size-1)return;
        onMove?.(id,index+delta[e.key]);}
    }}>{children}</span>;
}
