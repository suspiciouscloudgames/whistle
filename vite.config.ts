import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { portalRelayPlugin } from "./scripts/portals/vite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { KIND_PATCHES } from "./lib/audio/terrain-sources.ts";
import { PLACED_PATCH } from "./lib/audio/pd-sounds.ts";
import { MAIN } from "./lib/audio/pd-runtime.ts";
// pd4web 엔진은 SharedArrayBuffer(스레드)를 쓰므로 교차 출처 격리가 필요하다.
// 개발·미리보기 서버는 헤더로, 정적 호스팅은 public/coi-serviceworker.js로 건다.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

// audio/engine/(pd4web 엔진)과 audio/patches/(패치 폴더)를 /whistle/audio/… 로 내보낸다(개발 서버, 빌드 결과).
// - 엔진 파일은 그대로.
// - 패치 폴더는 하위 폴더째 tar 하나로 묶어 gzip한다(audio/patches.tar.gz). 브라우저의 Pd 엔진이 이걸 받아 자기 가상 디스크에 푼다
//   (lib/audio/pd-runtime.ts). HTTP로는 폴더를 통째로 받을 수 없어서 묶는다. 개발 서버는 요청 때마다 지금 폴더를 묶는다.
//   안을 보려면: tar tzf patches.tar.gz
// - 개발 서버는 패치 폴더가 바뀌면 페이지를 새로고침한다.
const audioDir = fileURLToPath(new URL("./audio/", import.meta.url));
const engineDir = join(audioDir, "engine");
const patchDir = join(audioDir, "patches");
const walk = (dir: string, prefix = ""): string[] => readdirSync(join(dir, prefix), { withFileTypes: true })
  .filter((f) => !f.name.startsWith("."))
  .flatMap((f) => f.isDirectory() ? walk(dir, `${prefix}${f.name}/`) : [`${prefix}${f.name}`]);
const audioHash = createHash("sha256");
for (const dir of [engineDir, patchDir]) for (const file of walk(dir).sort())
  audioHash.update(file).update(readFileSync(join(dir, file)));
const audioRevision = audioHash.digest("hex").slice(0, 12);

/** 폴더를 tar(ustar)로 묶고 gzip한다. 일반 파일만, 경로는 폴더 기준. */
function tar(dir: string) {
  const blocks: Buffer[] = [];
  for (const path of walk(dir)) {
    const data = readFileSync(join(dir, path));
    // 이름 칸은 100바이트. 길면 앞부분을 prefix 칸(155바이트)에 나눠 넣는다.
    let prefix = "", name = path;
    const cut = path.lastIndexOf("/");
    if (Buffer.byteLength(name) > 100 && cut > 0) [prefix, name] = [path.slice(0, cut), path.slice(cut + 1)];
    const header = Buffer.alloc(512);
    const put = (offset: number, text: string) => header.write(text, offset);
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, data.length.toString(8).padStart(11, "0") + "\0");
    put(136, Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0");
    put(148, "        ");
    put(156, "0");
    put(257, "ustar\0");
    put(263, "00");
    put(345, prefix);
    put(148, header.reduce((sum, b) => sum + b, 0).toString(8).padStart(6, "0") + "\0 ");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** 앱이 여는 패치(KIND_PATCHES, 장면 패치 main, 배치한 소리 placed_sound) 중 audio/patches/에 없는 것. 빌드도 개발 서버도 시작하지 않는다. */
const missingPatches = () => [...new Set([...Object.values(KIND_PATCHES), MAIN, PLACED_PATCH])]
  .filter((name) => !existsSync(join(patchDir, `${name}.pd`)));
const missingMessage = (names: string[]) => `patches missing from audio/patches/: ${names.map((n) => `${n}.pd`).join(", ")}`;

const types: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".gz": "application/gzip" };
let isBuild = false;
const audioFolder = (): Plugin => ({
  name: "whistle-audio-folder",
  buildStart() {
    const missing = isBuild ? missingPatches() : [];
    if (missing.length) this.error(missingMessage(missing));
  },
  configResolved(config) { isBuild = config.command === "build"; },
  configureServer(server) {
    const missing = missingPatches();
    if (missing.length) throw new Error(missingMessage(missing));
    const prefix = `${server.config.base}audio/`;
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent(req.url?.split("?")[0] ?? "");
      if (!path.startsWith(prefix)) return next();
      const rel = path.slice(prefix.length);
      const file = normalize(join(audioDir, rel));
      const body = rel === "patches.tar.gz" ? tar(patchDir)
        : file.startsWith(join(engineDir, "/")) && existsSync(file) ? readFileSync(file) : undefined;
      if (!body) return next();
      for (const [key, value] of Object.entries(isolation)) res.setHeader(key, value);
      res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.end(body);
    });
    // 패치를 고치면 페이지를 새로고침하지 않고 바뀐 파일만 보낸다(lib/audio/pd-runtime.ts가 엔진 디스크에 쓰고 슬롯을 다시 만든다).
    server.watcher.on("all", (event, file) => {
      if (!file.startsWith(join(patchDir, "/")) || !["add", "change", "unlink"].includes(event)) return;
      const path = relative(patchDir, file).split(sep).join("/");
      const data = event === "unlink" ? undefined : readFileSync(file).toString("base64");
      server.ws.send({ type: "custom", event: "whistle:patch", data: { path, data } });
      server.config.logger.info(`patch ${event === "unlink" ? "removed" : "updated"}: ${path}`, { timestamp: true });
    });
  },
  generateBundle() {
    for (const f of walk(engineDir)) this.emitFile({ type: "asset", fileName: `audio/engine/${f}`, source: readFileSync(join(engineDir, f)) });
    this.emitFile({ type: "asset", fileName: "audio/patches.tar.gz", source: tar(patchDir) });
  },
});

export default defineConfig({
  base: "/whistle/",
  define: { "import.meta.env.VITE_AUDIO_REVISION": JSON.stringify(audioRevision) },
  server: { headers: isolation, watch: { ignored: ["**/output/**", "**/.whistle-data/**"] } },
  preview: { headers: isolation },
  plugins: [react(), audioFolder(), portalRelayPlugin()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        audioLab: fileURLToPath(new URL("./audio-lab/index.html", import.meta.url)),
        soundscapeLab: fileURLToPath(new URL("./audio-lab/soundscape.html", import.meta.url)),
        uwbLab: fileURLToPath(new URL("./uwb-lab/index.html", import.meta.url)),
      },
    },
  },
});
