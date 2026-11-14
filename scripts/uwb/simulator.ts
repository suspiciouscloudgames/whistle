import { createSocket } from "node:dgram";
import { distanceTo, type BridgeConfig } from "../../lib/uwb/solver.ts";

export function startSimulator(config: BridgeConfig, port: number, host = "127.0.0.1") {
  const socket = createSocket("udp4");
  socket.on("error", (error) => console.error(`가상 장비 오류: ${error.message}`));
  let seq = 0;
  const start = Date.now();
  const xs = config.anchors.map((a) => a.x), zs = config.anchors.map((a) => a.z);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const radiusX = (Math.max(...xs) - Math.min(...xs)) * 0.35, radiusZ = (Math.max(...zs) - Math.min(...zs)) * 0.35;
  const tick = () => {
    seq++;
    config.tags.forEach((tagId, index) => {
      const angle = (Date.now() - start) / 4000 + index * Math.PI / 2;
      const point = { x: centerX + radiusX * Math.cos(angle), z: centerZ + radiusZ * Math.sin(angle),
        boardHeight: config.mode === "2d" ? config.fixedHeight : 1.2 + 0.5 * Math.sin(angle) };
      socket.send(JSON.stringify({ type: "ranges", tagId, seq,
        ranges: config.anchors.map((a) => ({ anchorId: a.id, distance: Math.round(distanceTo(point, a) * 100) / 100 })),
      }), port, host);
    });
  };
  const timer = setInterval(tick, 100);
  tick();
  return () => { clearInterval(timer); socket.close(); };
}
