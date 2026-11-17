import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRooms } from "./rooms.ts";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/whistle") { response.writeHead(302, { Location: "/whistle/" }).end(); return; }
    if (!url.pathname.startsWith("/whistle/")) { response.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.slice("/whistle/".length)) || "index.html";
    const file = resolve(root, relative);
    if (!file.startsWith(resolve(root) + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch { response.writeHead(404).end("Not found"); }
});
attachRooms(server);
const port = Number(process.env.PORT ?? 5173), host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => console.log(`Whistle: http://${host}:${port}/whistle/`));
