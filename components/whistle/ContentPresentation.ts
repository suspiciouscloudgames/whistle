import * as THREE from "three";
import type { Actor, Asset } from "../../lib/world.ts";
import { contentOpacity, floatingPose } from "../../lib/content-display.ts";

type Coating = { opacity: { value: number }; baseColor?: THREE.Color };
type Target = { actor: Actor; asset: Asset; model: THREE.Group; picture?: THREE.Object3D; materials: THREE.Material[]; coatings: { material: THREE.MeshStandardMaterial; projection: Coating }[] };

export function makeContentPresentation() {
  const targets: Target[] = [];
  const point = new THREE.Vector3(), white = new THREE.Color(1, 1, 1);
  return {
    sync(actors: Actor[], assets: Map<string, Asset>, models: Map<string, THREE.Group>, terrain: THREE.Group) {
      targets.length = 0;
      const byId = new Map<string, Target>();
      for (const actor of actors) {
        const asset = assets.get(actor.id), model = models.get(actor.id);
        if (!asset?.display || !model) continue;
        const target: Target = { actor, asset, model, picture: model.getObjectByName("symbol-content"), materials: [], coatings: [] };
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (mesh.material) target.materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
        });
        targets.push(target);
        byId.set(actor.id, target);
      }
      terrain.traverse(object => {
        const target = byId.get(object.userData.placementId);
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        const projection = material?.userData.surfaceProjection as Coating | undefined;
        if (target && material && projection) target.coatings.push({ material, projection });
      });
    },
    update(camera: THREE.Camera, size: number, time: number, overview: boolean, reducedMotion: boolean) {
      for (const { actor, asset, model, picture, materials, coatings } of targets) {
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
        const opacity = overview ? 1 : contentOpacity(asset.display, distance, time / 1000, actor.x * 1.7 + actor.z * .9, reducedMotion);
        for (const material of materials) material.opacity = opacity;
        for (const { material, projection } of coatings) {
          projection.opacity.value = opacity;
          if (projection.baseColor) material.color.copy(projection.baseColor).lerp(white, opacity);
        }
      }
    },
  };
}
