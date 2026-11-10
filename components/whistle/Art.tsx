import type { Asset } from "@/lib/world";
export function ObjectArt({
  asset,
  className = "",
}: {
  asset: Asset;
  className?: string;
}) {
  return (
    <svg
      className={`object-art ${className}`}
      viewBox="0 0 100 100"
      fill={asset.color}
      aria-label={asset.name}
      role="img"
    >
      {(asset.shape === "sphere" ||
        asset.shape === "bell" ||
        asset.shape === "image") && <circle cx="50" cy="50" r="28" />}
      {(asset.shape === "box" || asset.shape === "tree") && (
        <rect x="24" y="24" width="52" height="52" />
      )}
      {(asset.shape === "cone" || asset.shape === "flower") && (
        <path d="M50 19 82 77H18Z" />
      )}
      {(asset.shape === "diamond" || asset.shape === "stone") && (
        <path d="m50 14 32 36-32 36-32-36Z" />
      )}
      {(asset.shape === "bar" || asset.shape === "arch") && (
        <rect x="46" y="17" width="8" height="66" />
      )}
      {asset.shape === "ring" && (
        <circle
          cx="50"
          cy="50"
          r="27"
          fill="none"
          stroke={asset.color}
          strokeWidth="8"
        />
      )}
    </svg>
  );
}
