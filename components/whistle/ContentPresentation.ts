import * as THREE from "three";
import type { Actor, Asset } from "../../lib/world.ts";
import { contentOpacity, floatingPose } from "../../lib/content-display.ts";
import { makePassageParticles } from "./PassageParticles.ts";

type Coating = { opacity: { value: number }; baseColor?: THREE.Color };
type Target = {
  actor: Actor;
  asset: Asset;
  model: THREE.Group;
  picture?: THREE.Object3D;
  materials: THREE.Material[];
  coatings: { material: THREE.MeshStandardMaterial; projection: Coating }[];
  content?: string;
  ground: number;
  texture?: THREE.Texture;
};

export function makeContentPresentation() {
  const targets: Target[] = [];
  const particles = makePassageParticles();
  const passages = new Map<string, { asset: string; content: string; started: number; emitted: boolean }>();
  const point = new THREE.Vector3(), white = new THREE.Color(1, 1, 1);
  return {
    particles: particles.group,
    sync(actors: Actor[], assets: Map<string, Asset>, models: Map<string, THREE.Group>, terrain: THREE.Group, surfaceHeight?: (a: Actor) => number) {
      targets.length = 0;
      const byId = new Map<string, Target>();
      for (const actor of actors) {
        const asset = assets.get(actor.id), model = models.get(actor.id);
        if (!asset?.display || !model) continue;
        const target: Target = { actor, asset, model, picture: model.getObjectByName("symbol-content"), materials: [], coatings: [],
          content: asset.sound ? undefined : asset.text?.trim() || asset.image,
          ground: model.userData.surface && surfaceHeight ? surfaceHeight(actor) : model.position.y };
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (mesh.material) target.materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
        });
        target.texture = target.materials.map(material => (material as THREE.MeshBasicMaterial).map).find(map => !!map);
        targets.push(target);
        byId.set(actor.id, target);
      }
      terrain.traverse(object => {
        const target = byId.get(object.userData.placementId);
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        const projection = material?.userData.surfaceProjection as Coating | undefined;
        if (target && material && projection) {
          target.coatings.push({ material, projection });
          target.texture ??= material.map ?? undefined;
        }
      });
      for (const [id, passage] of passages) {
        const target = byId.get(id);
        if (target?.asset.id !== passage.asset || target.content !== passage.content) passages.delete(id);
      }
    },
    passContent(fromX: number, fromZ: number, x: number, z: number, feet: number, time: number) {
      const dx = x - fromX, dz = z - fromZ, lengthSq = dx * dx + dz * dz;
      if (!lengthSq) return 0;
      let passed = 0;
      for (const { actor, asset, content, ground, texture } of targets) {
        if (!content || !texture || actor.removed || passages.has(actor.id)) continue;
        const height = 1.65 + (asset.placement === "floating" ? 3 : 0);
        if (feet < ground - 1.65 || feet > ground + height) continue;
        const along = THREE.MathUtils.clamp(((actor.x - fromX) * dx + (actor.z - fromZ) * dz) / lengthSq, 0, 1);
        const radius = Math.min(1.5, .83 + .25 * actor.scale);
        if (Math.hypot(fromX + along * dx - actor.x, fromZ + along * dz - actor.z) > radius) continue;
        passages.set(actor.id, { asset: asset.id, content, started: time, emitted: false });
        passed++;
      }
      return passed;
    },
    update(camera: THREE.Camera, size: number, time: number, overview: boolean, reducedMotion: boolean) {
      for (const { actor, asset, model, picture, materials, coatings, texture, ground } of targets) {
        if (actor.removed) continue;
        if (picture) {
          const floating = asset.placement === "floating";
          if (floating) {
            const pose = floatingPose(time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
            picture.position.set(pose.x / actor.scale, .8 + pose.y / actor.scale, 0);
            picture.rotation.z = pose.roll;
            model.rotation.y = Math.atan2(camera.position.x - model.position.x, camera.position.z - model.position.z);
          } else {
            picture.position.set(0, .8, 0);
            picture.rotation.z = 0;
          }
        }
        let distance = 0;
        if (!overview && asset.display === "nearby") {
          if (picture) picture.getWorldPosition(point);
          else point.set(actor.x * 2 - size + 1, camera.position.y, actor.z * 2 - size + 1);
          distance = point.distanceTo(camera.position);
        }
        const passage = !overview && passages.get(actor.id);
        const elapsed = passage ? time - passage.started : 0;
        if (passage && !passage.emitted) {
          passage.emitted = true;
          if (!reducedMotion && elapsed < 170) {
            if (picture) picture.getWorldPosition(point);
            else point.set(actor.x * 2 - size + 1, ground + .12, actor.z * 2 - size + 1);
            particles.start(asset, texture, point, actor.scale, !!model.userData.surface, passage.started);
          }
        }
        const opacity = passage ? 1 - THREE.MathUtils.smoothstep(elapsed, 0, reducedMotion ? 320 : 90)
          : overview ? 1 : contentOpacity(asset.display, distance, time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
        for (const material of materials) material.opacity = opacity;
        for (const { material, projection } of coatings) {
          projection.opacity.value = opacity;
          if (projection.baseColor) material.color.copy(projection.baseColor).lerp(white, opacity);
        }
      }
      particles.update(time);
    },
  };
}
