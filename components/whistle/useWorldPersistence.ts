"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { abstractWorld, validateWorld, type World } from "@/lib/world";
import { upgradeTerrain } from "@/lib/terrain";
import { decodeWorld } from "@/lib/sharing";
import { createTerrainWorld } from "@/lib/create-world";

const STORAGE = "whistle.world.v2";

type Options = {
  world: World;
  onLoad: (world: World, beforeUpgrade: World) => void;
  onImport: (world: World) => void;
  notify: (message: string) => void;
};

export function useWorldPersistence({ world, onLoad, onImport, notify }: Options) {
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("준비 중");
  const autosaveAllowed = useRef(false);
  const resumeAutosave = useCallback(() => {
    if (new URLSearchParams(location.hash.slice(1)).has("world")) {
      window.history.replaceState(null, "", location.pathname + location.search);
    }
    autosaveAllowed.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    let active = true, generation = 0;
    const load = async (initial: boolean) => {
      const encoded = new URLSearchParams(location.hash.slice(1)).get("world");
      if (!initial && encoded === null) return;
      const request = ++generation;
      autosaveAllowed.current = false;
      setReady(false);
      try {
        let incoming: World | undefined;
        if (encoded !== null) incoming = await decodeWorld(encoded);
        else {
          const stored = localStorage.getItem(STORAGE);
          if (stored !== null) incoming = validateWorld(JSON.parse(stored));
          else {
            const previous = localStorage.getItem("whistle.world.v1");
            if (previous !== null)
              incoming = abstractWorld(validateWorld(JSON.parse(previous)));
          }
        }
        if (!incoming) incoming = createTerrainWorld();
        const beforeUpgrade = incoming;
        incoming = upgradeTerrain(incoming);
        if (!active || request !== generation) return;
        onLoad(incoming, beforeUpgrade);
        resumeAutosave();
      } catch (e) {
        if (active && request === generation) {
          setSaveStatus("불러오기 실패 · 자동 저장 중지");
          notify(e instanceof Error ? e.message : "저장한 세계를 불러오지 못했어요.");
        }
      }
    };
    void load(true);
    const changed = () => void load(false);
    window.addEventListener("hashchange", changed);
    return () => {
      active = false;
      window.removeEventListener("hashchange", changed);
    };
  }, [notify, onLoad, resumeAutosave]);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus("저장 중");
    const timeout = setTimeout(() => {
      if (!autosaveAllowed.current) return;
      try {
        localStorage.setItem(STORAGE, JSON.stringify(world));
        setSaveStatus("이 브라우저에 저장됨");
      } catch {
        setSaveStatus("저장 공간 부족 · 파일로 보관");
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [world, ready]);

  const importFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 6000000)
        throw Error("6MB 이하의 세계 파일을 선택해 주세요.");
      const imported = upgradeTerrain(validateWorld(JSON.parse(await file.text())));
      onImport(imported);
      resumeAutosave();
    } catch (e) {
      notify(e instanceof Error ? e.message : "세계 파일을 읽을 수 없어요.");
    }
  }, [notify, onImport, resumeAutosave]);

  return { ready, saveStatus, resumeAutosave, importFile };
}
