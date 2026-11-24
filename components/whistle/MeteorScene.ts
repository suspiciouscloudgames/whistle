import * as THREE from "three";
import { meteorRandom } from "../../lib/meteors.ts";

const COUNT = 12, SEGMENTS = 6;
const CORNERS = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];
type Streak = { start: number; duration: number; azimuth: number; elevation: number; travel: number; width: number };

export function makeMeteors() {
  const positions = new Float32Array(COUNT * SEGMENTS * 18);
  const colors = new Float32Array(positions.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "meteor-shower";
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = -900;
  let seed: number | undefined;
  let streaks: Streak[] = [];
  const head = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3();
  return { mesh, update(elapsed: number | null, nextSeed: number, camera: THREE.Camera, reducedMotion: boolean) {
    mesh.visible = elapsed !== null;
    if (elapsed === null) return;
    if (seed !== nextSeed) {
      seed = nextSeed;
      const random = meteorRandom(seed);
      streaks = Array.from({ length: COUNT }, (_, i) => ({ start: i < 2 ? i * .45 : .9 + random() * 7.8,
        duration: 1.1 + random() * .9, azimuth: (i % 3 - 1) * 1.7 + (random() - .5) * 1.2,
        elevation: .15 + random() * .25, travel: 6 + random() * 5, width: .1 + random() * .08 }));
    }
    mesh.position.copy(camera.position);
    let vertex = 0;
    for (const streak of streaks) {
      const progress = (elapsed - streak.start) / streak.duration;
      if (progress < 0 || progress > 1) continue;
      const fade = Math.min(1, progress * 8, (1 - progress) * 5) * (reducedMotion ? .45 : 1);
      const distance = progress * streak.travel * (reducedMotion ? .3 : 1);
      head.set(Math.sin(streak.azimuth) * 65, streak.elevation * 65, -Math.cos(streak.azimuth) * 65);
      tangent.set(Math.cos(streak.azimuth), -.48, Math.sin(streak.azimuth)).normalize();
      head.addScaledVector(tangent, distance);
      side.crossVectors(head, tangent).normalize().multiplyScalar(streak.width);
      for (let segment = 0; segment < SEGMENTS; segment++) {
        for (const [end, sign] of CORNERS) {
          const tail = (segment + end) / SEGMENTS;
          const length = tail * (reducedMotion ? 2 : 5.5);
          const width = (1 - tail) * sign;
          positions[vertex] = head.x - tangent.x * length + side.x * width;
          positions[vertex + 1] = head.y - tangent.y * length + side.y * width;
          positions[vertex + 2] = head.z - tangent.z * length + side.z * width;
          const light = fade * (1 - tail) ** 2;
          colors[vertex] = colors[vertex + 1] = colors[vertex + 2] = light;
          vertex += 3;
        }
      }
    }
    geometry.setDrawRange(0, vertex / 3);
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("color").needsUpdate = true;
  }};
}
