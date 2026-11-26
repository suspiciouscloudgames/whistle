import * as THREE from "three";
import type { Actor, Asset } from "../../lib/world.ts";
import { contentOpacity, floatingHeight, floatingPose } from "../../lib/content-display.ts";
import { bindContentReveal } from "./ContentReveal.ts";

type Reading = {
  asset: string; content: string;
  phase: "away" | "reading" | "passed";
  progress: number; opacity: number; departure: number;
  approach?: { x: number; z: number };
};
type Target = {
  actor: Actor; asset: Asset; model: THREE.Group; picture?: THREE.Object3D;
  materials: THREE.Material[];
  coatings: { opacity: { value: number } }[];
  masks: ReturnType<typeof bindContentReveal>[];
  ground: number; attached: boolean; reading?: Reading;
};

export function makeContentPresentation() {
  const targets = new Map<string, Target>();
  const point = new THREE.Vector3();
  let lastFrame: number | undefined;
  return {
    sync(actors: Actor[], assets: Map<string, Asset>, models: Map<string, THREE.Group>, terrain: THREE.Group, surfaceHeight?: (a: Actor) => number) {
      const previous = new Map(targets);
      targets.clear();
      for (const actor of actors) {
        const asset = assets.get(actor.id), model = models.get(actor.id);
        if (!asset?.display || !model || actor.removed) continue;
        const content = !asset.sound && (asset.text?.trim() || asset.image);
        const existing = previous.get(actor.id)?.reading;
        const target: Target = { actor, asset, model, picture: model.getObjectByName("symbol-content"), materials: [], coatings: [], masks: [],
          ground: model.userData.surface && surfaceHeight ? surfaceHeight(actor) : model.position.y,
          attached: asset.placement === "surface" || asset.placement === "field" };
        if (content) target.reading = existing?.asset === asset.id && existing.content === content ? existing
          : { asset: asset.id, content, phase: "away", progress: 0, opacity: 0, departure: 0 };
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.material) return;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            target.materials.push(material);
            const mapped = material as THREE.MeshBasicMaterial;
            if (target.reading && !target.attached && mapped.map) target.masks.push(bindContentReveal(mapped));
          }
        });
        targets.set(actor.id, target);
      }
      terrain.traverse(object => {
        const target = targets.get(object.userData.placementId);
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        const projection = material?.userData.surfaceProjection;
        if (target && material && projection) {
          target.coatings.push(projection);
        }
      });
    },
    passContent(fromX: number, fromZ: number, x: number, z: number, feet: number) {
      const dx = x - fromX, dz = z - fromZ, lengthSq = dx * dx + dz * dz;
      if (!lengthSq) return 0;
      let passed = 0;
      for (const { actor, asset, ground, coatings, materials, reading } of targets.values()) {
        if (reading?.phase !== "reading" || (!materials.length && !coatings.length)) continue;
        const height = 1.65 + (asset.placement === "floating" ? 3 : 0);
        const radius = Math.min(1.5, .83 + .25 * actor.scale);
        const along = ((actor.x - fromX) * dx + (actor.z - fromZ) * dz) / lengthSq;
        const nearest = THREE.MathUtils.clamp(along, 0, 1);
        if (feet < ground - 1.65 || feet > ground + height ||
            Math.hypot(fromX + nearest * dx - actor.x, fromZ + nearest * dz - actor.z) > radius) {
          reading.approach = undefined;
          continue;
        }
        if (!reading.approach && along >= 0) reading.approach = { x: dx / Math.sqrt(lengthSq), z: dz / Math.sqrt(lengthSq) };
        const dir = reading.approach;
        if (dir && (x - actor.x) * dir.x + (z - actor.z) * dir.z >= 0 && dx * dir.x + dz * dir.z > 0) {
          reading.phase = "passed";
          reading.approach = undefined;
          passed++;
        }
      }
      return passed;
    },
    update(camera: THREE.Camera, size: number, time: number, overview: boolean, reducedMotion: boolean) {
      const dt = lastFrame === undefined ? 0 : THREE.MathUtils.clamp((time - lastFrame) / 1000, 0, .25);
      lastFrame = time;
      for (const { actor, asset, model, picture, materials, coatings, masks, reading, ground, attached } of targets.values()) {
        if (picture) {
          if (asset.placement === "floating" && !asset.text?.trim()) {
            const pose = floatingPose(time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
            picture.position.set(pose.x / actor.scale, .8 + pose.y / actor.scale, 0);
            picture.rotation.z = pose.roll;
            model.rotation.y = Math.atan2(camera.position.x - model.position.x, camera.position.z - model.position.z);
          } else {
            const lift = asset.placement === "floating" ? floatingHeight / actor.scale : 0;
            picture.position.set(0, .8 + lift, 0);
            picture.rotation.z = 0;
          }
        }
        let opacity = 1, progress = 1, departure = 0;
        if (!overview) {
          if (picture) picture.getWorldPosition(point);
          else point.set(actor.x * 2 - size + 1, ground + .8, actor.z * 2 - size + 1);
          const distance = point.distanceTo(camera.position);
          if (reading) {
            if (distance >= 8.5) { reading.phase = "away"; reading.approach = undefined; }
            if (reading.phase === "away" && distance <= 6.5) {
              reading.phase = "reading";
              reading.progress = reading.opacity = reading.departure = 0;
            }
            if (!attached) {
              if (reading.phase === "reading") {
                const duration = reducedMotion ? .45 : masks[0]?.duration ?? 1.6;
                reading.progress = Math.min(1, reading.progress + dt / duration);
                reading.opacity = Math.min(1, reading.opacity + dt / (asset.text || reducedMotion ? .45 : duration));
              } else {
                reading.opacity = Math.max(0, reading.opacity - dt / 1.35);
                if (reading.phase === "passed") reading.departure = Math.min(1, reading.departure + dt / 1.35);
                if (!reading.opacity) reading.progress = 0;
              }
              opacity = THREE.MathUtils.smoothstep(reading.opacity, 0, 1);
              progress = reducedMotion ? 1 : reading.progress;
              departure = reducedMotion ? 0 : reading.departure;
            }
          } else {
            opacity = contentOpacity(asset.display, distance, time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
          }
        }
        for (const mask of masks) {
          mask.progress.value = progress;
          mask.departure.value = departure;
        }
        for (const material of materials) material.opacity = opacity;
        for (const projection of coatings) projection.opacity.value = opacity;
      }
    },
  };
}
