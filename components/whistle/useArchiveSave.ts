import { useRef, useState } from "react";
import { publishWorld } from "@/lib/archive";
import { ARCHIVE_FILE_LIMIT } from "@/lib/archive-protocol";
import { downloadWorld } from "@/lib/sharing";
import type { World } from "@/lib/world";
import { userErrorMessage } from "./Language";

type Save = { file: Blob; local: boolean };

export function useArchiveSave(notify: (message: string) => void) {
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);
  const [failure, setFailure] = useState<{ save: Save; reason: string } | null>(null);
  function upload(save: Save) {
    const sequence = ++latest.current;
    setFailure(null);
    notify("아카이브에 저장 중입니다.");
    queue.current = queue.current.then(async () => {
      try {
        await publishWorld(save.file);
        if (sequence === latest.current) notify(save.local ? "로컬 파일과 아카이브에 저장했습니다." : "아카이브에 저장했습니다. 로컬 다운로드를 시작하지 못했습니다.");
      } catch (error) {
        if (sequence === latest.current) {
          notify("");
          setFailure({ save, reason: userErrorMessage(error, "아카이브 요청에 실패했습니다.") });
        }
      }
    });
  }
  function saveFile(world: World) {
    const file = new Blob([JSON.stringify(world, null, 2)], { type: "application/json" });
    let local = false;
    try { downloadWorld(file, world.title); local = true; } catch { /* The archive upload can still succeed. */ }
    upload({ file, local });
  }
  return { saveFile, failure, dismiss: () => setFailure(null),
    retry: failure && failure.save.file.size <= ARCHIVE_FILE_LIMIT ? () => upload(failure.save) : undefined };
}
