import * as THREE from "three";
import { meteorRandom, MAX_METEORS_PER_SHOWER, type MeteorShower } from "../../lib/meteors.ts";

const CORNERS = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];

function meteorTexture() {
  const width = 36, height = 9;
  const pixels = new Uint8Array(width * height * 4);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const random = meteorRandom(94);
  for (let x = 0; x < width; x++) {
    const tail = (x + .5) / width;
    const radius = Math.min(1, Math.sqrt(tail / .08)) * (1 - .5 * tail);
    const center = .12 * Math.sin(tail * 12) + .09 * Math.sin(tail * 23);
    for (let y = 0; y < height; y++) {
      const side = Math.abs((y + .5) * 2 / height - 1 - center);
      const body = THREE.MathUtils.clamp((radius - side) * 2.4, 0, 1);
      const density = body * (1 - tail ** 1.4);
      const threshold = .6 * (bayer[(y % 4) * 4 + x % 4] + .5) / 16 + .4 * random();
      const alpha = density > threshold ? .55 + .45 * density : .12 * density;
      const shade = 1 - .25 * tail - .12 * random();
      const offset = (y * width + x) * 4;
      pixels[offset] = 255 * shade;
      pixels[offset + 1] = 255 * shade * (1 - .35 * tail);
      pixels[offset + 2] = 255 * shade * (1 - .45 * tail);
      pixels[offset + 3] = 255 * alpha;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function makeShowerMesh() {
  const geometry = new THREE.BufferGeometry();
  const vertices = MAX_METEORS_PER_SHOWER * CORNERS.length;
  const positions = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Float32Array(vertices * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage);
  const uv = new THREE.BufferAttribute(new Float32Array(vertices * 2), 2);
  for (let i = 0; i < vertices; i++) {
    const [tail, side] = CORNERS[i % CORNERS.length];
    uv.setXY(i, tail, (side + 1) / 2);
  }
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  geometry.setAttribute("uv", uv);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({ map: meteorTexture(), vertexColors: true, transparent: true,
    depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "meteor-shower";
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = -900;
  return { mesh, positions, colors };
}

export function makeMeteors() {
  const group = new THREE.Group();
  const pool: ReturnType<typeof makeShowerMesh>[] = [];
  const nightColor = new THREE.Color("#f2ada0"), dayColor = new THREE.Color("#a34f43");
  const head = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3();
  return { group, update(showers: MeteorShower[], time: number, camera: THREE.Camera, reducedMotion: boolean, daylight: number) {
    group.visible = showers.length > 0;
    if (!group.visible) return;
    group.position.copy(camera.position);
    while (pool.length < showers.length) {
      const batch = makeShowerMesh();
      pool.push(batch);
      group.add(batch.mesh);
    }
    for (let i = 0; i < pool.length; i++) {
      const { mesh, positions, colors } = pool[i];
      const shower = showers[i];
      mesh.visible = !!shower;
      if (!shower) continue;
      mesh.material.color.lerpColors(nightColor, dayColor, daylight);
      const elapsed = (time - shower.startedAt) / 1000;
      let vertex = 0;
      for (const streak of shower.streaks) {
        const progress = (elapsed - streak.start) / streak.duration;
        if (progress < 0 || progress > 1) continue;
        const fade = Math.min(1, progress * 8, (1 - progress) * 5) * (reducedMotion ? .45 : 1);
        const distance = progress * streak.travel * (reducedMotion ? .3 : 1);
        const { azimuth, elevation } = streak;
        head.set(Math.sin(azimuth) * 65, elevation * 65, -Math.cos(azimuth) * 65);
        tangent.set(Math.cos(azimuth), -.48, Math.sin(azimuth)).normalize();
        head.addScaledVector(tangent, distance);
        side.crossVectors(head, tangent).normalize().multiplyScalar(streak.width);
        for (const [tail, sign] of CORNERS) {
          const length = tail * (reducedMotion ? 2.8 : 7.4);
          positions.setXYZ(vertex, head.x - tangent.x * length + side.x * sign,
            head.y - tangent.y * length + side.y * sign, head.z - tangent.z * length + side.z * sign);
          colors.setW(vertex, fade);
          vertex++;
        }
      }
      mesh.geometry.setDrawRange(0, vertex);
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }
  }};
}
