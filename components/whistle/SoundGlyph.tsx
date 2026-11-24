export function SoundGlyph({ color = "currentColor", filled = true }: { color?: string; filled?: boolean }) {
  return <svg viewBox="0 0 32 32" className="site-glyph" aria-hidden="true" style={{ color }}>
    <rect x="6" y="6" width="20" height="20" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
  </svg>;
}
