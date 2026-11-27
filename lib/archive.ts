import { ARCHIVE_FILE_LIMIT, ARCHIVE_PATH, archiveIdPattern, type ArchivePage } from "./archive-protocol";
import { archiveWriterKey } from "./browser-world";
import { contentKind, MAX_LIBRARY_SIZE } from "./content-limits";
import { upgradeTerrain } from "./terrain";
import { uid, validateWorld } from "./world";

async function request(url: string, options: RequestInit) {
  const response = await fetch(url, { ...options, cache: "no-store", redirect: "error" });
  if (response.status === 503) throw new Error("아카이브가 아직 연결되지 않았습니다.");
  if (response.status === 429) throw new Error("잠시 후 다시 저장해 주세요.");
  if (response.status === 413) throw new Error("아카이브에는 32MiB 이하의 파일을 저장할 수 있습니다.");
  if (response.status === 400 && options.method === "POST") throw new Error("지원하지 않는 파일 형식입니다.");
  if (response.status === 404) throw new Error("이 세계를 찾을 수 없습니다.");
  if (!response.ok) throw new Error("아카이브 요청에 실패했습니다.");
  return response;
}

export async function publishWorld(file: Blob) {
  if (file.size > ARCHIVE_FILE_LIMIT) throw new Error("아카이브에는 32MiB 이하의 파일을 저장할 수 있습니다.");
  const key = await archiveWriterKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60000);
  try {
    const response = await request(ARCHIVE_PATH, { method: "POST", body: file, signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    });
    const { id } = await response.json();
    if (typeof id !== "string" || !archiveIdPattern.test(id)) throw new Error("아카이브 요청에 실패했습니다.");
  } finally { clearTimeout(timer); }
}

export async function listWorlds(cursor: string | undefined, signal: AbortSignal): Promise<ArchivePage> {
  const query = cursor ? "?" + new URLSearchParams({ cursor }) : "";
  const result = await request(ARCHIVE_PATH + query, { signal });
  const page = await result.json() as ArchivePage;
  if (!Array.isArray(page.items)) throw new Error("아카이브 요청에 실패했습니다.");
  return page;
}

export async function openArchivedWorld(id: string, signal: AbortSignal) {
  const writer = await archiveWriterKey().catch(() => undefined);
  const result = await request(ARCHIVE_PATH + "/" + id, { signal, headers: writer ? { Authorization: "Bearer " + writer } : {} });
  const world = upgradeTerrain(validateWorld(await result.json(), MAX_LIBRARY_SIZE));
  if (result.headers.get("X-Whistle-Archive-Owner") !== "1") {
    if (world.workshop) world.workshop.id = uid();
    const received = new Set(world.receivedMaterialIds);
    const ids = new Map<string,string>();
    for (const asset of world.assets) {
      if (asset.received || received.has(asset.id) || !(asset.prompt || contentKind(asset))) continue;
      const id = uid();
      ids.set(asset.id,id);
      asset.id=id;
    }
    for (const object of world.objects) object.asset=ids.get(object.asset) ?? object.asset;
    for (const rule of world.rules) {
      if (rule.subject!=="*") rule.subject=ids.get(rule.subject) ?? rule.subject;
      if (rule.source!=="*") rule.source=ids.get(rule.source) ?? rule.source;
      rule.replacement=ids.get(rule.replacement) ?? rule.replacement;
    }
  }
  return world;
}
