import { useEffect, useRef, useState } from "react";
import { listWorlds, openArchivedWorld } from "@/lib/archive";
import type { ArchiveEntry } from "@/lib/archive-protocol";
import type { World } from "@/lib/world";
import { Dialog } from "./Dialogs";
import { useLanguage, userErrorMessage } from "./Language";

export function ArchiveDialog({ onOpen, onClose }: { onOpen: (world: World) => string | undefined; onClose: () => void }) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<ArchiveEntry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listFailed, setListFailed] = useState(false);
  const current = useRef<AbortController | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  function start() {
    current.current?.abort();
    current.current = new AbortController();
    setError(""); setLoading(true);
    return current.current.signal;
  }
  async function load(after?: string) {
    const signal = start();
    setListFailed(false);
    try {
      const page = await listWorlds(after, signal);
      if (signal.aborted) return;
      setItems(previous => {
        const all = new Map((after ? previous : []).map(item => [item.id, item]));
        for (const item of page.items) all.set(item.id, item);
        return [...all.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
      setCursor(page.cursor);
    } catch (e) {
      if (!signal.aborted) { setListFailed(true); setError(userErrorMessage(e, "아카이브 요청에 실패했습니다.")); }
    } finally { if (!signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    void load();
    return () => current.current?.abort();
  }, []);
  async function select(id: string) {
    const signal = start();
    try {
      const world = await openArchivedWorld(id, signal);
      if (signal.aborted) return;
      const reason = open.current(world);
      if (reason) setError(reason);
      else onClose();
    } catch (e) {
      if (!signal.aborted) setError(userErrorMessage(e, "세계를 불러오지 못했습니다. 다시 시도해 주세요."));
    } finally { if (!signal.aborted) setLoading(false); }
  }
  return <Dialog title={t("아카이브")} onClose={onClose} className="archive-dialog">
    {items.length > 0 && <ul className="archive-list">{items.map(item =>
      <li key={item.id}><button disabled={loading} onClick={() => void select(item.id)}>
        <span>{item.title || t("이름 없는 세계")}</span>
        <time dateTime={item.updatedAt}>{item.updatedAt && new Date(item.updatedAt).toLocaleDateString(language)}</time>
      </button></li>
    )}</ul>}
    {loading && <p role="status">{t("불러오는 중…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {!loading && !error && !items.length && <p>{t("아직 공개된 세계가 없습니다.")}</p>}
    {!loading && (cursor || listFailed) && <button onClick={() => void load(cursor)}>{t(listFailed ? "다시 시도" : "더 보기")}</button>}
  </Dialog>;
}
