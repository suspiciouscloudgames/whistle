"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function GridCell({
  children,
  label,
  className,
  onTap,
  onHold,
}: {
  children: ReactNode;
  label: string;
  className: string;
  onTap: () => void;
  onHold?: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const pressed = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pressed.current = false;
  };
  useEffect(() => cancel, []);
  return (
    <button
      className={className}
      aria-label={label}
      onPointerDown={(e) => {
        cancel();
        held.current = false;
        pressed.current = true;
        origin.current = { x: e.clientX, y: e.clientY };
        if (onHold && e.button === 0)
          timer.current = setTimeout(() => {
            held.current = true;
            onHold();
          }, 450);
      }}
      onPointerMove={(e) => {
        if (
          pressed.current &&
          Math.hypot(
            e.clientX - origin.current.x,
            e.clientY - origin.current.y,
          ) > 8
        ) {
          cancel();
          held.current = true;
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") held.current = false;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
        held.current = true;
        onHold?.();
      }}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onTap();
      }}
    >
      {children}
    </button>
  );
}
