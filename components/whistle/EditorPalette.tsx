"use client";
import { SoundGlyph } from "./SoundGlyph";
import type { Asset, Weather, TimeOfDay } from "@/lib/world";
import { SURFACES, type Surface } from "@/lib/terrain";
import type { TerrainTool } from "@/lib/tile";
import { DaylightIndicator } from "./DaylightIndicator";
import { WeatherControls } from "./WeatherControls";
import { HoleGlyph } from "./HoleGlyph";
import { useLanguage } from "./Language";
import type { ReactNode } from "react";

type Props = {
  timeOfDay?: TimeOfDay;
  weather?: Weather; surface: Surface; terrainTool: TerrainTool; placingStart: boolean;
  symbols: Asset[]; selectedSymbol?: string;
  sharedSymbolIds?: ReadonlySet<string>;
  startLocked?: boolean;
  onSelectSurface: (surface: Surface) => void;
  onSelectTerrainTool: (tool: TerrainTool) => void;
  onTimeOfDayChange: (time: TimeOfDay) => void;
  onWeatherChange: (weather: Weather) => void;
  canPlace: boolean;
  onBlocked: () => void;
  onSelectSymbol: (id: string) => void;
  onEditSymbol: (id: string) => void;
  onToggleStart: () => void;
  extraTools?: ReactNode;
};

export function EditorPalette({ weather, timeOfDay, surface, terrainTool, placingStart, symbols, selectedSymbol, sharedSymbolIds, startLocked,
  onSelectSurface, onSelectTerrainTool, onWeatherChange, onTimeOfDayChange, canPlace, onBlocked, onSelectSymbol, onEditSymbol, onToggleStart, extraTools }: Props) {
  const { t } = useLanguage();
  return <aside className="palette direct-palette generated-palette" aria-label={t("재료")}>
    <div className={`tile-palette${canPlace ? "" : " placement-locked"}`}>
      <div className="surface-choices" aria-label={t("타일")}>
        {(["plain", "soft", "slick", "rough"] as const).map(id => {
          const entry = SURFACES.find(entry => entry.id === id)!;
          return <button key={id} className={`surface-choice ${surface === id && terrainTool === "surface" && !placingStart && !selectedSymbol ? "active" : ""}`}
            aria-label={t(entry.name)} aria-pressed={surface === id && terrainTool === "surface" && !placingStart && !selectedSymbol}
            aria-disabled={!canPlace} onClick={() => canPlace ? onSelectSurface(id) : onBlocked()}><span className={`surface-swatch surface-${id}`} /></button>;
        })}
        <button className={`surface-choice clear-tile ${terrainTool === "hole" && !placingStart && !selectedSymbol ? "active" : ""}`}
          aria-label={t("꺼짐")} aria-pressed={terrainTool === "hole" && !placingStart && !selectedSymbol}
          aria-disabled={!canPlace} onClick={() => canPlace ? onSelectTerrainTool("hole") : onBlocked()}><HoleGlyph className="hole-glyph" /></button>
        <button className={`surface-choice ${terrainTool === "erase" && !placingStart && !selectedSymbol ? "active" : ""}`}
          aria-label={t("타일 지우기")} aria-pressed={terrainTool === "erase" && !placingStart && !selectedSymbol}
          aria-disabled={!canPlace} onClick={() => canPlace ? onSelectTerrainTool("erase") : onBlocked()}><span className="surface-swatch empty-swatch" /></button>
      </div>
      <div className="height-choices" aria-label={t("바닥 높이")}>
        {(["raise", "lower"] as const).map(tool => <button key={tool} aria-label={t(tool === "raise" ? "높이기" : "낮추기")}
          aria-pressed={terrainTool === tool && !placingStart && !selectedSymbol}
          className={terrainTool === tool && !placingStart && !selectedSymbol ? "active" : ""} aria-disabled={!canPlace} onClick={() => canPlace ? onSelectTerrainTool(tool) : onBlocked()}>{tool === "raise" ? "↑" : "↓"}</button>)}
      </div>
      {!startLocked && <button className={`site-start ${placingStart ? "active" : ""}`} aria-label={t("시작점")}
        aria-pressed={placingStart} onClick={onToggleStart}>◎</button>}
    </div>
    {symbols.length > 0 && <div className="generated-symbols" aria-label={t("만든 기호")}>
      <div className="symbol-library">{symbols.map(symbol => <div key={symbol.id} className={`symbol-library-item${sharedSymbolIds?.has(symbol.id) ? " received-material" : ""}`}
        data-material-origin={sharedSymbolIds?.has(symbol.id) ? "received" : "own"}>
        <button data-symbol-asset={symbol.id} className={selectedSymbol === symbol.id ? "active" : ""}
          aria-pressed={selectedSymbol === symbol.id} aria-label={`${t("배치")}: ${symbol.text ?? symbol.name}`}
          aria-disabled={!canPlace} onClick={() => canPlace ? onSelectSymbol(symbol.id) : onBlocked()}>
          {symbol.sound ? <span className="sound-symbol"><SoundGlyph color={symbol.glyphColor ?? symbol.color} /><span>{symbol.name}</span></span> : symbol.text !== undefined ? <span style={{ color: symbol.textColor }}>{symbol.text.slice(0, 2)}</span> : <img src={symbol.image} alt="" />}
        </button>
        {<button className="symbol-edit" aria-label={t("편집")} onClick={() => onEditSymbol(symbol.id)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="m3 10 7-7 3 3-7 7-4 1zM9 4l3 3" /></svg>
        </button>}
      </div>)}</div>
    </div>}
    {extraTools}
    <div className="palette-climate">
      <DaylightIndicator value={timeOfDay} onChange={onTimeOfDayChange} />
      <WeatherControls className="palette-weather" value={weather} onChange={onWeatherChange} />
    </div>
  </aside>;
}
