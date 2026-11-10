import type { Weather } from "@/lib/world";
import { useLanguage } from "./Language";
export function WeatherControls({ value = "clear", onChange, className = "" }: {
  value?: Weather; onChange: (weather: Weather) => void; className?: string;
}) {
  const { t } = useLanguage();
  return <div className={`weather-controls ${className}`} role="group" aria-label={t("날씨")}>
    {([ ["cloud", "구름"], ["rain", "비"], ["snow", "눈"] ] as const).map(([kind, label]) =>
      <button key={kind} aria-label={t(label)} aria-pressed={value === kind}
        onClick={() => onChange(value === kind ? "clear" : kind)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {kind !== "snow" && <path d="M6 15a4 4 0 1 1 .5-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 1 1 1 7H6Z" />}
          {kind === "rain" && <path d="m7 18-1 3m6-3-1 3m6-3-1 3" />}
          {kind === "snow" && <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3M4.5 11l4-1-1-4M19.5 13l-4 1 1 4M4.5 13l4 1-1 4M19.5 11l-4-1 1-4" />}
        </svg>
      </button>)}
  </div>;
}
