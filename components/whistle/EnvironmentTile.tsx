import type { EnvironmentCell } from "@/lib/environment";

export function environmentTileKind(c: EnvironmentCell) {
  if (c.water !== null) return "water";
  if (c.tree) return "tree";
  if (c.grass > 0) return "grass";
  if (c.fog > 0.05) return "fog";
  if (Math.hypot(c.windX, c.windZ) > 0.1) return "wind";
  return null;
}

/** The result replaces the material pattern. Fog can coexist with water or plants. */
export function EnvironmentTile({ cell }: { cell: EnvironmentCell }) {
  const kind = environmentTileKind(cell);
  if (!kind) return null;
  const mist = cell.fog > 0.05 && kind !== "fog";
  return (
    <svg
      className={`result-tile result-${kind}`}
      data-result={kind}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect width="32" height="32" fill="#fff" />
      <g
        fill="none"
        stroke="#000"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "water" && (
          <path d="M-4 9Q0 4 4 9T12 9T20 9T28 9T36 9M-4 17Q0 12 4 17T12 17T20 17T28 17T36 17M-4 25Q0 20 4 25T12 25T20 25T28 25T36 25" />
        )}
        {kind === "grass" && (
          <path
            d="M16 24V8M16 24Q14 16 8 14M16 24Q18 16 24 12"
            strokeWidth="1.2"
          />
        )}
        {kind === "tree" && (
          <g strokeWidth="1.2">
            <circle cx="16" cy="12" r="5.5" />
            <path d="M16 17.5V25" />
          </g>
        )}
        {kind === "fog" && (
          <path
            d="M4 9H16M21 9H28M2 16H9M14 16H25M6 23H20M25 23H30"
            strokeWidth="2.2"
          />
        )}
        {kind === "wind" && (
          <g transform={cell.windZ ? "rotate(-90 16 16)" : undefined}>
            <path d="M3 12H22C29 12 29 4 24 5M6 19H26M3 25H17C24 25 24 30 20 29" />
          </g>
        )}
      </g>
      {mist && (
        <g
          data-result="fog"
          fill="none"
          stroke="#000"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M3 3H14M20 3H28M7 8H22M26 8H30" />
        </g>
      )}
    </svg>
  );
}
