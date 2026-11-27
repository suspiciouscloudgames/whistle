import { useRef, useState } from "react";
import { publishWorld } from "@/lib/archive";
import { ARCHIVE_FILE_LIMIT } from "@/lib/archive-protocol";
import { userErrorMessage } from "./Language";

export function useArchiveSave() {
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);
  const [failure, setFailure] = useState<{ file: Blob; reason: string } | null>(null);
  function upload(file: Blob) {
    const sequence = ++latest.current;
    setFailure(null);
    queue.current = queue.current.then(async () => {
      try {
        await publishWorld(file);
      } catch (error) {
        if (sequence === latest.current) {
          setFailure({ file, reason: userErrorMessage(error, "아카이브 요청에 실패했습니다.") });
        }
      }
    });
  }
  return { upload, failure, dismiss: () => setFailure(null),
    retry: failure && failure.file.size <= ARCHIVE_FILE_LIMIT ? () => upload(failure.file) : undefined };
}
