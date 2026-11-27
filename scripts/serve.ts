import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { attachMeetingRelay } from "./meeting/relay.ts";
import { attachPortalRelay } from "./portals/relay.ts";
import { createArchiveApi } from "./archive.ts";

const handleArchive = createArchiveApi();
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".mp3": "audio/mpeg" };
const server = createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  try {
    if (await handleArchive(request, response)) return;
    if (!["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(405).end(); return; }
    const url = new URL(request.url || "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    if (path === "/whistle" || path === "/whistle/" || path === "/whistle/index.html") {
      response.writeHead(302, { Location: `/${url.search}` }).end(); return;
    }
    if (path !== "/" && !path.startsWith("/whistle/")) { response.writeHead(404).end(); return; }
    let file = resolve(root, path === "/" ? "index.html" : path.slice("/whistle/".length));
    if (!file.startsWith(resolve(root) + sep)) { response.writeHead(404).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const info = await stat(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Content-Length": info.size, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  } catch { response.writeHead(404).end(); }
});
const relay = attachPortalRelay(server);
const meetingRelay = attachMeetingRelay(server);
const port = Number(process.env.PORT ?? 5173);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`Whistle: http://localhost:${port}/`));
const stop = async () => { relay.close(); await meetingRelay.close(); server.close(); server.closeAllConnections(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
