import * as THREE from "three";
import { MEETING_LEMON } from "../../lib/meeting.ts";
import { TRAIL_CAPACITY, TRAIL_LENGTH_TILES, TRAIL_LIFETIME_MS, type MeetingTrail, type TrailPoint } from "../../lib/meeting-trail.ts";
import { floorHeight } from "../../lib/terrain.ts";
import { environmentAt } from "../../lib/environment.ts";
import type { World } from "../../lib/world.ts";
import type { WorldDerivation } from "../../lib/world-derivation.ts";

export function createPeerTrailLine() {
  const positions = new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const taper = new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  geometry.setAttribute("taper", taper);
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { lemon: { value: new THREE.Color(MEETING_LEMON) }, elapsed: { value: 0 } },
    transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `
      attribute vec2 taper;
      varying vec2 behindHead;
      void main() {
        behindHead = taper;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 lemon;
      uniform float elapsed;
      varying vec2 behindHead;
      void main() {
        float life = clamp(1.0 - elapsed - behindHead.x, 0.0, 1.0);
        float alpha = .95 * pow(min(life, 1.0 - clamp(behindHead.y, 0.0, 1.0)), 1.55);
        if (alpha < .002) discard;
        gl_FragColor = vec4(lemon, alpha);
      }`,
  });
  const line = new THREE.Line(geometry, material);
  line.name = "peer-movement-trail";
  line.visible = false;
  line.frustumCulled = false;
  let lastHead: TrailPoint | undefined;
  let lastGround: WorldDerivation | undefined;
  let heights = new WeakMap<TrailPoint, number | null>();

  function update(trail: MeetingTrail | undefined, world: World, ground: WorldDerivation, now: number) {
    const points = trail?.points;
    const head = points?.at(-1);
    if (!points || points.length < 2 || !head || now - head.time >= TRAIL_LIFETIME_MS) {
      if (lastHead) {
        line.visible = false;
        geometry.setDrawRange(0, 0);
        lastHead = undefined;
      }
      return;
    }
    if (head !== lastHead || ground !== lastGround) {
      if (ground !== lastGround) heights = new WeakMap();
      let count = 0;
      for (const p of points) {
        let height = heights.get(p);
        if (height === undefined) {
          const floor = floorHeight(world, p.x, p.z, ground.structures);
          height = floor === null ? null : Math.max(floor, environmentAt(ground.environment, p.x, p.z).water ?? floor);
          heights.set(p, height);
        }
        if (height === null) {
          count = 0;
          continue;
        }
        positions.setXYZ(count, p.x * 2 - world.size + 1, height + .18, p.z * 2 - world.size + 1);
        taper.setXY(count, (head.time - p.time) / TRAIL_LIFETIME_MS, (head.distance - p.distance) / TRAIL_LENGTH_TILES);
        count++;
      }
      positions.needsUpdate = true;
      taper.needsUpdate = true;
      geometry.setDrawRange(0, count);
      lastHead = head;
      lastGround = ground;
    }
    material.uniforms.elapsed.value = Math.max(0, now - head.time) / TRAIL_LIFETIME_MS;
    line.visible = geometry.drawRange.count >= 2;
  }
  return { line, update };
}
