"use client";
import type { Actor, World } from "@/lib/world";
import type { PlacementFeedback } from "@/lib/placement-feedback";
import type { WorldDerivation } from "@/lib/world-derivation";
import { tileAt, SURFACES } from "@/lib/terrain";
import { isHole } from "@/lib/tile";
import { PaintGrid } from "./PaintGrid";
import { EnvironmentTile, environmentTileKind } from "./EnvironmentTile";
import { ObjectArt } from "./Art";
import { useLanguage } from "./Language";

type Props = {
  world: World;
  actors: Actor[];
  derivation: WorldDerivation;
  feedback: PlacementFeedback | null;
  canHold: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onPaint: (cells: number[], erase: boolean) => void;
  onEnd: () => void;
  onSelectObject: (id: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
};

export function EditorBoard({
  world, actors, derivation, feedback, canHold, canUndo, canRedo,
  onPaint, onEnd, onSelectObject, onUndo, onRedo,
}: Props) {
  const { t } = useLanguage();
  const { structures, environment } = derivation;
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
  return (
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
          canHold={canHold}
          onPaint={onPaint}
          onEnd={onEnd}
          onHold={(i) =>
            onSelectObject(
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
            const actor = actors.find(
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
            disabled={!canUndo}
            onClick={onUndo}
          >
            ↶
          </button>
          <button
            aria-label={t("다시 실행")}
            disabled={!canRedo}
            onClick={onRedo}
          >
            ↷
          </button>
        </div>
      </div>
    </section>
  );
}
