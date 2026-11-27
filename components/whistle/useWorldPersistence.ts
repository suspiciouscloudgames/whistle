"use client";
import { userErrorMessage } from "./Language";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { abstractWorld, validateWorld, type World } from "@/lib/world";
import { upgradeTerrain } from "@/lib/terrain";
import { createTerrainWorld } from "@/lib/create-world";
import type { BrowserWorldStore } from "@/lib/browser-world";

const STORAGE = "whistle.world.v2";
const TAB_STORAGE = "whistle.world.tab.v1";

type Options = {
  world: World;
  onLoad: (world: World, beforeUpgrade: World) => void;
  onImport: (world: World) => string | void;
  notify: (message: string) => void;
  enabled?: boolean;
  libraryLimit?: number;
  storage?: BrowserWorldStore;
  fallbackWorld?: World;
};

export function useWorldPersistence({ world, onLoad, onImport, notify, enabled = true, libraryLimit, storage, fallbackWorld }: Options) {
  const [ready, setReady] = useState(!enabled);
  const [loading, setLoading] = useState(enabled);
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
    if (!enabled) return;
    let active = true;
    const load = async () => {
      autosaveAllowed.current = false;
      setReady(false);
      setLoading(true);
      try {
        let incoming: World | undefined;
        if (storage) {
          const stored=await storage.read();
          if(stored)incoming=validateWorld(stored,libraryLimit);
        } else {
          const stored = sessionStorage.getItem(TAB_STORAGE) ?? localStorage.getItem(STORAGE);
          if (stored !== null) incoming = validateWorld(JSON.parse(stored),libraryLimit);
          else {
            const previous = localStorage.getItem("whistle.world.v1");
            if (previous !== null) incoming = abstractWorld(validateWorld(JSON.parse(previous)));
          }
        }
        if (!incoming) incoming = fallbackWorld ?? createTerrainWorld();
        const beforeUpgrade = incoming;
        incoming = upgradeTerrain(incoming);
        if (!active) return;
        onLoad(incoming, beforeUpgrade);
        resumeAutosave();
      } catch {
        if (active) {
          setSaveStatus("불러오기에 실패해 자동 저장이 중지되었습니다.");
        }
      } finally {
        if(active)setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [onLoad, resumeAutosave, enabled, libraryLimit, storage, fallbackWorld]);

  useLayoutEffect(() => {
    if (!ready || !enabled) return;
    setSaveStatus("저장 중");
    let pending = true, active = true;
    const save = async () => {
      if (!pending || !autosaveAllowed.current) return;
      pending = false;
      try {
        if(storage)await storage.write(world);
        else {
          const serialized = JSON.stringify(world);
          sessionStorage.setItem(TAB_STORAGE, serialized);
          localStorage.setItem(STORAGE, serialized);
        }
        if(active)setSaveStatus("이 브라우저에 저장됨");
      } catch {
        pending = true;
        if(active)setSaveStatus("저장 공간이 부족합니다.");
      }
    };
    const timeout = storage ? undefined : setTimeout(save, 350);
    if(storage)void save();
    window.addEventListener("pagehide", save);
    return () => { active=false;clearTimeout(timeout); window.removeEventListener("pagehide", save); };
  }, [world, ready, enabled, storage]);

  const importFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const imported = upgradeTerrain(validateWorld(JSON.parse(await file.text()),libraryLimit));
      const reason = onImport(imported);
      if (reason) { notify(reason); return; }
      resumeAutosave();
    } catch (e) {
      notify(userErrorMessage(e, "파일을 읽을 수 없습니다."));
    }
  }, [notify, onImport, resumeAutosave, libraryLimit]);

  return { ready, loading, saveStatus, resumeAutosave, importFile };
}
