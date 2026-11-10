import { validateWorld, type World } from "./world";
export async function encodeWorld(w: World): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(w));
  const compressed = typeof CompressionStream !== "undefined";
  const data = compressed
    ? new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
        ).arrayBuffer(),
      )
    : bytes;
  let binary = "";
  for (const n of data) binary += String.fromCharCode(n);
  return (
    (compressed ? "z" : "j") +
    btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  );
}
export async function decodeWorld(encoded: string): Promise<World> {
  if (encoded.length > 500000)
    throw Error("공유 링크가 너무 커요. 세계 파일로 가져와 주세요.");
  if (!["z", "j"].includes(encoded[0]))
    throw Error("지원하지 않는 공유 링크예요.");
  const bytes = Uint8Array.from(
    atob(encoded.slice(1).replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  let stream = new Blob([bytes]).stream();
  if (encoded[0] === "z") {
    if (typeof DecompressionStream === "undefined")
      throw Error(
        "이 브라우저에서는 링크를 열 수 없어요. 최신 브라우저를 사용해 주세요.",
      );
    stream = stream.pipeThrough(new DecompressionStream("gzip"));
  }
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 6000000) {
      await reader.cancel();
      throw Error("세계 데이터가 너무 커요.");
    }
    chunks.push(value);
  }
  return validateWorld(JSON.parse(await new Blob(chunks as BlobPart[]).text()));
}
export function downloadWorld(w: World) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(w, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${w.title || "나의 세계"}.whistle.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
