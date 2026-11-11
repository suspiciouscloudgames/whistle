"use client";
import type { Asset, Weather } from "@/lib/world";
import { SURFACES, type Surface } from "@/lib/terrain";
import type { TerrainTool } from "@/lib/tile";
import { ObjectArt } from "./Art";
import { WeatherControls } from "./WeatherControls";
import { useLanguage } from "./Language";

type Props = {
  assets: Asset[];
  weather?: Weather;
  layer: "tiles" | "symbols";
  surface: Surface;
  terrainTool: TerrainTool;
  selectedAsset: string;
  placingStart: boolean;
  onSelectLayer: (layer: "tiles" | "symbols") => void;
  onSelectSurface: (surface: Surface) => void;
  onSelectTerrainTool: (tool: TerrainTool) => void;
  onReroll: () => void;
  onWeatherChange: (weather: Weather) => void;
  onEditAsset: (asset: Asset) => void;
  onToggleStart: () => void;
};

export function EditorPalette({
  assets, weather, layer, surface, terrainTool, selectedAsset, placingStart,
  onSelectLayer, onSelectSurface, onSelectTerrainTool, onReroll, onWeatherChange,
  onEditAsset, onToggleStart,
}: Props) {
  const { t } = useLanguage();
  return (
    <aside className="palette direct-palette" aria-label={t("재료")}>
      <div className="layer-tabs compact-layer-tabs">
        <button
          aria-label={t("타일")}
          aria-pressed={layer === "tiles"}
          className={layer === "tiles" ? "active" : ""}
          onClick={() => onSelectLayer("tiles")}
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
          onClick={() => onSelectLayer("symbols")}
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
                onClick={() => onSelectSurface(entry.id)}
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
                  onClick={() => onSelectTerrainTool(tool)}
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
                onClick={() => onSelectTerrainTool("hole")}
              >
                <span aria-hidden="true" />
              </button>
              <button aria-label={t("다른 지형")} onClick={onReroll}>
                <span aria-hidden="true">↻</span>
              </button>
            </div>
            <WeatherControls className="weather-desktop" value={weather}
              onChange={onWeatherChange} />
          </div>
        </div>
      ) : (
        <div className="symbols">
          {assets.map((a) => (
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
              onClick={() => onEditAsset(a)}
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
            onClick={onToggleStart}
          >
            ◎
          </button>
        </div>
      )}
    </aside>
  );
}
