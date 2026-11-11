"use client";
import type { MutableRefObject } from "react";
import type { Player } from "@/lib/world";
import { useLanguage } from "./Language";

type Props = {
  controls: MutableRefObject<Set<string>>;
  padPressedAt: MutableRefObject<Map<string, number>>;
  player: MutableRefObject<Player>;
  movementMode: "walk" | "crouch";
  onMovementModeChange: (mode: "walk" | "crouch") => void;
};

export function PlayControls({
  controls, padPressedAt, player, movementMode, onMovementModeChange,
}: Props) {
  const { t } = useLanguage();
  return (
    <div className="touch-controls" aria-label={t("이동 터치패드")}>
      {(
        [
          {
            key: "forward",
            command: "step",
            className: "direction-forward",
            label: "앞으로",
            glyph: "⌃",
          },
          {
            key: "left",
            command: "turn-left",
            className: "direction-left",
            label: "왼쪽으로 회전",
            glyph: "‹",
          },
          {
            key: "backward",
            command: "backstep",
            className: "direction-back",
            label: "뒤로",
            glyph: "⌄",
          },
          {
            key: "right",
            command: "turn-right",
            className: "direction-right",
            label: "오른쪽으로 회전",
            glyph: "›",
          },
        ] as const
      ).map(({ key, command, className, label, glyph }) => (
        <button
          key={key}
          className={className}
          aria-label={t(label)}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            padPressedAt.current.set(key, performance.now());
            controls.current.add(key);
          }}
          onPointerUp={() => {
            controls.current.delete(key);
            if (
              performance.now() - (padPressedAt.current.get(key) ?? 0) <
              180
            )
              controls.current.add(command);
            padPressedAt.current.delete(key);
          }}
          onPointerCancel={() => {
            controls.current.delete(key);
            padPressedAt.current.delete(key);
          }}
          onLostPointerCapture={() => controls.current.delete(key)}
          onClick={(e) => {
            if (e.detail === 0) controls.current.add(command);
          }}
        >
          <span aria-hidden="true">{glyph}</span>
        </button>
      ))}
      <div className="movement-modes">
        <button aria-label={t("점프")}
          onPointerDown={(e) => {
            e.preventDefault();
            if (!player.current.falling) controls.current.add("jump");
          }}
          onClick={(e) => {
            if (e.detail === 0 && !player.current.falling) controls.current.add("jump");
          }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 14l4-4 4 4" /></svg>
        </button>
        <button aria-label={t("기어가기")}
          aria-pressed={movementMode === "crouch"}
          onClick={() => {
            if (player.current.falling) return;
            const next = movementMode === "crouch" ? "walk" : "crouch";
            controls.current.delete("run");
            controls.current.delete("crouch");
            if (next === "crouch") controls.current.add("crouch");
            onMovementModeChange(next);
          }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4" /></svg>
        </button>
      </div>
    </div>
  );
}
