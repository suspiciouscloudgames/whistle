// pd4web 엔진(Pd 0.56 + vanilla 객체를 wasm으로)을 한 번 빌드해 audio/engine/에 둔다.
// 엔진에는 패치가 들어가지 않는다(빈 host 패치만). 패치는 실행 중에 sendFile로 넣고 동적으로 만든다.
// 그래서 패치를 고쳐도 이 빌드는 다시 할 필요가 없다. pd4web 버전을 올리거나 외부 객체가 필요할 때만 돌린다.
//
//   npm run audio:engine                 (PATH의 pd4web)
//   PD4WEB=/path/to/pd4web npm run audio:engine
//
// pd4web CLI는 파이썬 패키지(pip install pd4web, Python 3.12+). 첫 빌드는 Emscripten 등을 받아 오래 걸린다.
//
// pdlua(GPL-2.0-or-later)는 빼고 빌드한다. pd4web 3.4.1은 pdlua를 항상 링크하므로, CLI가 만든 빌드 폴더의
// 사본에서 pdlua 부분을 잘라 내고 같은 cmake/ninja로 한 번 더 빌드한다. 우리는 Lua 객체와 GUI를 쓰지 않는다.
// pd4web 버전을 바꿔 잘라 낼 코드가 달라지면 여기서 멈춘다(조용히 pdlua가 남지 않도록).
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const engineDir = join(root, "audio/engine");
const pd4web = process.env.PD4WEB || "pd4web";
/** wasm 메모리(MB). 메모리가 늘어나지 않는 빌드라 슬롯과 업로드한 소리(1분 스테레오 하나에 wav 사본 11.5MB + 배열 23MB)를 감당할 만큼 잡는다. */
const MEMORY_MB = 256;
/** 엔진 결과물 중 앱이 쓰는 파일 */
const FILES = ["pd4web.js", "pd4web.wasm", "pd4web.data"];

// `pd4web --version`은 "pd4web 3.4.1 | built ..."를 출력하고 0이 아닌 코드로 끝난다.
const probe = spawnSync(pd4web, ["--version"], { encoding: "utf8" });
const version = /pd4web\s+(\S+)/.exec(`${probe.stdout}${probe.stderr}`)?.[1];
if (!version) throw new Error(`pd4web CLI를 찾지 못했습니다(${pd4web}). pip install pd4web 후 PATH에 두거나 PD4WEB=경로 로 지정하세요.`);

/** 파일에서 정확히 한 번 나오는 문자열을 바꾼다. 없거나 여러 번이면 멈춘다. */
async function replaceOnce(file, from, to) {
  // pd4web가 만든 파일은 CRLF와 LF가 섞여 있다. LF로 맞춘 뒤 비교한다.
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`pdlua 제거: ${file}에서 ${count}번 나옴(1번이어야 함): ${from.slice(0, 60)}`);
  await writeFile(file, text.replace(from, to));
}

/** CLI가 만든 빌드 폴더(out)에서 pdlua 링크·호출·패키징을 뺀다. */
async function stripPdlua(out) {
  const src = join(out, "Pd4Web");
  const cmake = join(out, "CMakeLists.txt");
  await replaceOnce(cmake, `include("\${CMAKE_CURRENT_SOURCE_DIR}/Pd4Web/Externals/pdlua.cmake")`, "# pdlua 제외(whistle)");
  await replaceOnce(cmake, `target_link_libraries(pd4web PRIVATE \n                                pdlua)`, "");
  await replaceOnce(cmake, `            thorvg\n            pdlua)`, `            thorvg)`);
  const hpp = join(src, "pd4web.hpp");
  await replaceOnce(hpp, `#include <lua.h>\n#include <lauxlib.h>\n#include <lualib.h>\n\n#include <pdlua.h>\nextern lua_State *__L();\nextern void pdlua_setup();\nextern void pdlua_gfx_process_recovery(void);\n`, "");
  const cpp = join(src, "pd4web.cpp");
  await replaceOnce(cpp, `    libpd_set_instance(ud->libpd);\n    pdlua_gfx_process_recovery();\n    ProcessSenders(ud);`, `    libpd_set_instance(ud->libpd);\n    ProcessSenders(ud);`);
  await replaceOnce(cpp, `    if (mainThreadOwnsPd) {\n        pdlua_gfx_process_recovery();\n        ProcessSenders(ud);`, `    if (mainThreadOwnsPd) {\n        ProcessSenders(ud);`);
  await replaceOnce(cpp, `    pdlua_setup();\n    Pd4WebInitExternals();`, `    Pd4WebInitExternals();`);
  const text = await readFile(cpp, "utf8");
  // 키 입력을 Lua 객체에 넘기는 함수: 본문을 비운다(Lua 객체 없음).
  const start = text.indexOf("void ProcessKeyEvent(Pd4WebUserData *ud, const KeyEventData &data) {");
  const end = text.indexOf("\n}\n", start);
  if (start < 0 || end < 0 || !text.slice(start, end).includes("__L()")) throw new Error("pdlua 제거: ProcessKeyEvent를 찾지 못했습니다");
  await writeFile(cpp, text.slice(0, start) + "void ProcessKeyEvent(Pd4WebUserData *ud, const KeyEventData &data) {\n    (void)ud; (void)data; // pdlua 제외(whistle)" + text.slice(end));
  // 남은 호출이 있으면(다른 버전) 멈춘다.
  for (const file of [cpp, hpp]) {
    const left = (await readFile(file, "utf8")).match(/pdlua_\w+\(|__L\(\)|lua_State/g);
    if (left) throw new Error(`pdlua 제거: ${file}에 남은 호출 ${[...new Set(left)].join(", ")}`);
  }
}
// 빌드 폴더는 지우지 않고 다시 쓴다(두 번째 빌드부터 캐시로 1~2분).
const work = join(root, "output/pd4web-engine");
{
  const source = join(work, "src");
  const out = join(work, "out");
  await mkdir(source, { recursive: true });
  // 빈 host: 슬롯(서브패치)은 JS가 동적 패칭 메시지로 만든다(lib/audio/pd-runtime.ts).
  await writeFile(join(source, "index.pd"), "#N canvas 0 50 450 300 12;\n#X text 20 20 whistle host: slots are created by JS;\n");
  const started = Date.now();
  console.log(`pd4web ${version}: 엔진 빌드 중...`);
  execFileSync(pd4web, ["--nogui", "-m", String(MEMORY_MB), "-o", out, "index.pd"], { cwd: source, stdio: ["ignore", "ignore", "inherit"] });
  console.log("pdlua 제외하고 다시 빌드 중...");
  await stripPdlua(out);
  const cache = await readFile(join(out, ".build/CMakeCache.txt"), "utf8");
  const cmakeBin = /^CMAKE_COMMAND:INTERNAL=(.+)$/m.exec(cache)?.[1];
  if (!cmakeBin || !existsSync(cmakeBin)) throw new Error("pd4web 빌드 폴더의 cmake를 찾지 못했습니다(.build/CMakeCache.txt)");
  execFileSync(cmakeBin, ["--build", join(out, ".build")], { stdio: ["ignore", "ignore", "inherit"] });
  for (const name of FILES) {
    const bytes = await readFile(join(out, "WebPatch", name));
    if (bytes.includes("pdlua") || bytes.includes("pd.lua")) throw new Error(`pdlua 제거 실패: ${name}에 pdlua 흔적이 있습니다`);
  }
  await mkdir(engineDir, { recursive: true });
  for (const name of FILES) await copyFile(join(out, "WebPatch", name), join(engineDir, name));
  console.log(`pd4web ${version} 엔진 빌드 완료 (${((Date.now() - started) / 1000).toFixed(0)}s) → audio/engine/`);
}
