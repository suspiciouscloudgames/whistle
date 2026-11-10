"use client";
import { useLanguage } from "./Language";
import { useRef, type ReactNode } from "react";
type Props = {
  size: number;
  renderCell: (i: number) => ReactNode;
  cellClass: (i: number) => string;
  label: (i: number) => string;
  occupied: (i: number) => boolean;
  onPaint: (cells: number[], erase: boolean) => void;
  onEnd: () => void;
  onHold: (i: number) => void;
  canHold: boolean;
};
export function PaintGrid(p: Props) {
  const { t } = useLanguage();
  const gesture = useRef<{
    id: number;
    first: number;
    last: number;
    x: number;
    y: number;
    erase: boolean;
    moved: boolean;
    held: boolean;
    cells: Set<number>;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const clearTimer = () => {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
  };
  return (
    <div
      className="world-grid paint-grid"
      role="group"
      aria-label={t("격자")}
      style={{ gridTemplateColumns: `repeat(${p.size},1fr)` }}
      onPointerDown={(e) => {
        if (e.button !== 0 || gesture.current) return;
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
          "[data-cell]",
        );
        if (!button) return;
        const i = Number(button.dataset.cell);
        e.currentTarget.setPointerCapture(e.pointerId);
        const g = {
          id: e.pointerId,
          first: i,
          last: i,
          x: e.clientX,
          y: e.clientY,
          erase: p.occupied(i),
          moved: false,
          held: false,
          cells: new Set([i]),
          timer: undefined as ReturnType<typeof setTimeout> | undefined,
        };
        gesture.current = g;
        if (p.canHold && p.occupied(i))
          g.timer = setTimeout(() => {
            g.held = true;
            p.onHold(i);
          }, 450);
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId || g.held) return;
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 7 && !g.moved)
          return;
        clearTimer();
        g.moved = true;
        const r = e.currentTarget.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(
            p.size - 1,
            Math.floor(((e.clientX - r.left) / r.width) * p.size),
          ),
        );
        const z = Math.max(
          0,
          Math.min(
            p.size - 1,
            Math.floor(((e.clientY - r.top) / r.height) * p.size),
          ),
        );
        const ax = g.last % p.size,
          az = Math.floor(g.last / p.size),
          steps = Math.max(Math.abs(x - ax), Math.abs(z - az), 1);
        for (let n = 0; n <= steps; n++)
          g.cells.add(
            Math.round(az + ((z - az) * n) / steps) * p.size +
              Math.round(ax + ((x - ax) * n) / steps),
          );
        g.last = z * p.size + x;
        p.onPaint([...g.cells], g.erase);
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        clearTimer();
        if (!g.held && !g.moved) p.onPaint([g.first], g.erase);
        gesture.current = null;
        p.onEnd();
      }}
      onPointerCancel={() => {
        clearTimer();
        gesture.current = null;
        p.onEnd();
      }}
      onLostPointerCapture={() => {
        clearTimer();
        gesture.current = null;
        p.onEnd();
      }}
    >
      {Array.from({ length: p.size * p.size }, (_, i) => (
        <button
          key={i}
          data-cell={i}
          className={`grid-cell ${p.cellClass(i)}`}
          aria-label={p.label(i)}
          onClick={(e) => {
            if (e.detail === 0) {
              p.onPaint([i], p.occupied(i));
              p.onEnd();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (p.canHold && p.occupied(i)) p.onHold(i);
          }}
        >
          {p.renderCell(i)}
        </button>
      ))}
    </div>
  );
}
