import { mkdir, mkdtemp, rm, readFile, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const webpd = dirname(require.resolve("webpd/package.json"));
const { readMetadata } = await import(pathToFileURL(join(webpd, "dist/node_modules/@webpd/compiler/dist/src/run/index.js")));
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "public/audio-test");
const temporary = await mkdtemp(join(tmpdir(), "whistle-webpd-"));
let wasm, runtime;
try {
  execFileSync(process.execPath, [join(webpd, "bin/cli.mjs"), "-i", join(root, "audio/patches/interaction-test.pd"), "-o", temporary, "-f", "app"], { stdio: "inherit" });
  wasm = await readFile(join(temporary, "patch.wasm"));
  runtime = await readFile(join(temporary, "webpd-runtime.js"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const metadata = await readMetadata("assemblyscript", wasm);
const ports = (specs) => Object.fromEntries(Object.entries(specs).flatMap(([id, portlets]) => {
  const node = metadata.customMetadata.graph[id];
  if (node.type !== "send" && node.type !== "receive") return [];
  if (!node.args.busName || portlets.length !== 1) throw new Error(`Unexpected Pd port: ${id}`);
  return [[node.args.busName, { nodeId: id, portletId: portlets[0] }]];
}));
const io = {
  inputs: ports(metadata.settings.io.messageReceivers),
  outputs: ports(metadata.settings.io.messageSenders),
};
for (const name of ["whistle-edit", "whistle-player", "whistle-gate", "whistle-event", "whistle-player-stop", "whistle-board-height"]) {
  if (!io.inputs[name] || !io.outputs[name]) throw new Error(`Missing Pd bus: ${name}`);
}
if (!io.outputs["whistle-ready"]) throw new Error("Missing Pd ready signal");
await mkdir(output, { recursive: true });
await writeFile(join(output, "patch.wasm"), wasm);
await writeFile(join(output, "webpd-runtime.js"), runtime);
await writeFile(join(output, "io.json"), JSON.stringify(io, null, 2) + "\n");
for (const name of ["COPYING", "COPYING.LESSER"]) await copyFile(join(webpd, name), join(output, name));
console.log(`WebPd patch compiled: ${wasm.byteLength} bytes`);
