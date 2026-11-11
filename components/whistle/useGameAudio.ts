"use client";
import { useEffect, useMemo, useRef } from "react";
import { createPdSession, type EditSound } from "@/lib/audio/webpd-session";
import { createGameAudio } from "@/lib/audio/game-audio";
import { playerSound, type PlayerAudioFrame } from "@/lib/audio/game-parameters";
import type { Event, Player } from "@/lib/world";

export function useGameAudio(notify: (message: string) => void) {
  const controller = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const report = useRef(notify);
  report.current = notify;
  const api = useMemo(() => {
    const get = () => controller.current ??= createGameAudio(
      () => createPdSession(`${import.meta.env.BASE_URL}audio-test/`, () => {}),
      () => report.current("오디오를 시작하지 못했어요. 다음 클릭에서 다시 시도합니다."),
    );
    return {
      edit: (sound: EditSound) => get().edit(sound),
      play: () => get().play(),
      stop: () => controller.current?.stop(),
      reset: () => controller.current?.reset(),
      movement: (frame: PlayerAudioFrame) => controller.current?.movement(playerSound(frame)),
      event: (event: Event, player: Player) => {
        const distance = Math.hypot(event.x - player.x, event.z - player.z);
        const angle = Math.atan2(event.x - player.x, -(event.z - player.z)) - player.yaw;
        controller.current?.event(
          [261.63, 329.63, 392, 523.25, 659.25][Math.abs(Math.round(event.x + event.z)) % 5],
          0.12 / (1 + distance * 0.3), Math.sin(angle),
        );
      },
    };
  }, []);
  useEffect(() => {
    const pause = () => controller.current?.pause();
    const visibility = () => { if (document.hidden) pause(); };
    const resume = () => { if (!document.hidden) controller.current?.resume(); };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  return api;
}
