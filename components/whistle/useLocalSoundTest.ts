import { useState } from "react";

const STORAGE = "whistle.localSoundTest";

export function useLocalSoundTest() {
  const available = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const [enabled, setEnabled] = useState(() => {
    try { return available && sessionStorage.getItem(STORAGE) === "1"; }
    catch { return false; }
  });
  return {
    available, enabled,
    change(value: boolean) {
      const next = available && value;
      setEnabled(next);
      try { sessionStorage.setItem(STORAGE, next ? "1" : "0"); }
      catch { /* Keep the setting usable even when browser storage is disabled. */ }
    },
  };
}
