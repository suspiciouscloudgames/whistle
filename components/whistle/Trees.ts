import * as THREE from "three";
import { GUST_GLSL } from "../../lib/environment-effects.ts";
import { randomSequence } from "../../lib/terrain.ts";
import { environmentAt, type Environment } from "../../lib/environment.ts";
import {
  TREE_SPECIES,
  treeAppearance,
  type TreeSpecies,
} from "../../lib/vegetation.ts";
import type { World } from "../../lib/world.ts";

type Branch = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  tipRadius: number;
  color: THREE.Color;
};
type Leaf = {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  scale: THREE.Vector3;
  color: THREE.Color;
  wind: THREE.Vector2;
};


function leafGeometry(species: TreeSpecies) {
  const p: number[] = [],
    indices: number[] = [],
    colors: number[] = [];
  if (species === "pine") {
    for (let needle = 0; needle < 11; needle++) {
      const angle = needle * 2.39996,
        length = 0.19 + (needle % 4) * 0.035,
        i = p.length / 3;
      const dx = Math.cos(angle),
        dz = Math.sin(angle);
      p.push(
        -dz * 0.006,
        0,
        dx * 0.006,
        dz * 0.006,
        0,
        -dx * 0.006,
        dx * length * 0.65,
        length * 0.55,
        dz * length * 0.65,
      );
      indices.push(i, i + 1, i + 2);
      colors.push(0.55, 0.65, 0.5, 0.55, 0.65, 0.5, 1, 1, 1);
    }
  } else if (species === "ginkgo" || species === "maple") {
    p.push(0, 0, 0);
    colors.push(0.55, 0.65, 0.4);
    const segments = species === "maple" ? 14 : 12;
    for (let i = 0; i <= segments; i++) {
      const angle = -Math.PI * 0.68 + (i / segments) * Math.PI * 1.36;
      const r =
        species === "maple"
          ? i % 2
            ? 0.13
            : 0.24
          : 0.22 * (1 - 0.12 * Math.exp(-Math.pow(angle * 9, 2)));
      p.push(
        Math.sin(angle) * r,
        0.018 + Math.cos(angle) * 0.015,
        Math.cos(angle) * r + 0.065,
      );
      colors.push(0.82, 0.92, 0.7);
      if (i > 0) indices.push(0, i, i + 1);
    }
  } else {
    for (let i = 0; i <= 5; i++) {
      const t = i / 5,
        w = Math.sin(t * Math.PI) * 0.075 * (i % 2 ? 0.9 : 1);
      p.push(
        -w,
        Math.sin(t * Math.PI) * 0.027,
        t * 0.24,
        w,
        Math.sin(t * Math.PI) * 0.027,
        t * 0.24,
      );
      colors.push(
        0.65 + t * 0.35,
        0.72 + t * 0.28,
        0.55 + t * 0.45,
        0.65 + t * 0.35,
        0.72 + t * 0.28,
        0.55 + t * 0.45,
      );
      if (i < 5) {
        const n = i * 2;
        indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function makeTrees(
  world: World,
  env: Environment,
  clock: { value: number },
) {
  const group = new THREE.Group();
  group.name = "generated-trees";
  const branches: Branch[] = [];
  const leaves: Record<TreeSpecies, Leaf[]> = {
    pine: [],
    zelkova: [],
    ginkgo: [],
    maple: [],
  };
  const profiles: ReturnType<typeof treeAppearance>[] = [];
  for (const tree of env.trees) {
    const profile = treeAppearance(world.terrain?.seed ?? 0, tree.x, tree.z);
    profiles.push(profile);
    const { species, height: h, width, lean, rotation } = profile;
    const branchStart = branches.length, leafStart = leaves[species].length;
    const random = randomSequence(profile.seed ^ 0x3b19);
    const root = new THREE.Vector3(
      tree.x * 2 - world.size + 1,
      tree.height,
      tree.z * 2 - world.size + 1,
    );
    const c = environmentAt(env, tree.x, tree.z),
      wind = new THREE.Vector2(c.windX, c.windZ);
    const bark = new THREE.Color(
      species === "pine"
        ? "#76523b"
        : species === "ginkgo"
          ? "#686352"
          : "#625d50",
    );
    const base = new THREE.Color(
      species === "pine"
        ? "#426344"
        : species === "ginkgo"
          ? "#78963e"
          : species === "maple"
            ? "#4f7e3d"
            : "#527947",
    );
    base.lerp(
      new THREE.Color(species === "pine" ? "#63815a" : "#92a65a"),
      profile.tint * 0.3,
    );
    const trunkAt = (t: number) =>
      root
        .clone()
        .add(
          new THREE.Vector3(
            lean * t * t + Math.sin(t * 4) * 0.08,
            h * t,
            Math.sin(t * 3 + rotation) * 0.13 * t,
          ),
        );
    const branch = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      radius: number,
      curve = 0.12,
    ) => {
      let previous = a;
      for (let step = 1; step <= 5; step++) {
        const t = step / 5,
          end = a.clone().lerp(b, t);
        end.y += Math.sin(t * Math.PI) * curve;
        branches.push({
          a: previous,
          b: end,
          radius: radius * (1 - ((step - 1) / 5) * 0.62),
          tipRadius: radius * (1 - t * 0.62),
          color: bark,
        });
        previous = end;
      }
    };
    const crown = (
      center: THREE.Vector3,
      rx: number,
      ry: number,
      rz: number,
      count: number,
    ) => {


      for (let n = 0; n < Math.ceil(count * .6); n++) {
        const angle = random() * Math.PI * 2,
          y = random() * 2 - 1;
        const radial = Math.sqrt(1 - y * y) * Math.cbrt(random());
        const p = center
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(angle) * rx * radial,
              y * ry,
              Math.sin(angle) * rz * radial,
            ),
          );
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (random() - 0.5) * 1.9,
            random() * Math.PI * 2,
            (random() - 0.5) * 1.7,
          ),
        );
        const s = (0.65 + random() * 0.65) * 1.25;
        const color = base
          .clone()
          .multiplyScalar(0.7 + random() * 0.55 + (y + 1) * 0.05);
        leaves[species].push({
          p,
          q,
          scale: new THREE.Vector3(s, s, s),
          color,
          wind,
        });
      }
    };
    const trunkEnd =
      species === "zelkova" ? 0.6 : species === "maple" ? 0.58 : 1;
    for (let i = 0; i < 14; i++) {
      const r = 0.16 + width * 0.025;
      branches.push({
        a: trunkAt((i / 14) * trunkEnd),
        b: trunkAt(((i + 1) / 14) * trunkEnd),
        radius: r * (1 - (i / 14) * 0.88),
        tipRadius: r * (1 - ((i + 1) / 14) * 0.88),
        color: bark,
      });
    }
    const limbs = species === "pine" ? 10 : species === "ginkgo" ? 16 : 9;
    for (let k = 0; k < limbs; k++) {
      const t = k / (limbs - 1),
        angle = rotation + k * 2.39996 + (random() - 0.5) * 0.5;
      const y =
        species === "pine"
          ? 0.43 + t * 0.48
          : species === "ginkgo"
            ? 0.26 + t * 0.65
            : 0.32 + t * 0.24;
      const start = trunkAt(y);
      const reach =
        width *
        (species === "ginkgo"
          ? (1 - t) * 0.8 + 0.18
          : species === "pine"
            ? 1 - t * 0.6
            : 0.75 + random() * 0.45);
      const end = start
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * reach,
            (species === "pine" ? 0.12 : 0.24) * h + (random() - 0.5) * 0.35,
            Math.sin(angle) * reach,
          ),
        );
      branch(
        start,
        end,
        0.055 * (1 - t * 0.5),
        species === "pine" ? -0.18 : 0.18,
      );
      const forks = species === "pine" ? 3 : 4;
      for (let f = 0; f < forks; f++) {
        const theta = angle + (f - (forks - 1) / 2) * 0.65;
        const tip = end
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(theta) * (0.35 + random() * 0.4),
              species === "pine" ? 0.15 : random() * 0.65,
              Math.sin(theta) * (0.35 + random() * 0.4),
            ),
          );
        branch(start.clone().lerp(end, 0.65 + f * 0.07), tip, 0.018, 0.08);
        crown(
          tip,
          species === "pine" ? 0.65 : 0.6,
          species === "pine" ? 0.18 : 0.46,
          species === "pine" ? 0.55 : 0.6,
          species === "pine" ? 55 : species === "ginkgo" ? 38 : 64,
        );
      }
    }
    crown(
      trunkAt(species === "pine" ? 0.96 : species === "ginkgo" ? 0.94 : 0.86),
      0.65,
      0.5,
      0.65,
      180,
    );

    const shrink = (p: THREE.Vector3) => p.sub(root).multiplyScalar(profile.scale).add(root);
    for (let i = branchStart; i < branches.length; i++) {
      const b = branches[i];

      b.a = shrink(b.a.clone());
      b.b = shrink(b.b.clone());
      b.radius *= profile.scale;
      b.tipRadius *= profile.scale;
    }
    for (let i = leafStart; i < leaves[species].length; i++) {
      const leaf = leaves[species][i];
      shrink(leaf.p);
      leaf.scale.multiplyScalar(profile.scale);
    }
  }
  group.userData.profiles = profiles;
  const matrix = new THREE.Matrix4(),
    s = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  if (branches.length) {
    const material = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      vertexColors: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 barkPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nbarkPosition = position;",
      );
      shader.fragmentShader =
        "varying vec3 barkPosition;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float furrow=sin(barkPosition.x*63.0+barkPosition.z*57.0+sin(barkPosition.y*8.0)*.7);
        diffuseColor.rgb *= .82+.18*smoothstep(-.4,.6,furrow);`,
      );
    };
    const positions: number[] = [],
      normals: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    for (const b of branches) {
      const axis = b.b.clone().sub(b.a).normalize();
      const u = new THREE.Vector3()
        .crossVectors(
          axis,
          Math.abs(axis.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up,
        )
        .normalize();
      const v = new THREE.Vector3().crossVectors(axis, u).normalize();
      const start = positions.length / 3;
      for (let end = 0; end < 2; end++)
        for (let k = 0; k <= 12; k++) {
          const angle = (k / 12) * Math.PI * 2;
          const normal = u
            .clone()
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(v, Math.sin(angle));
          const point = (end ? b.b : b.a)
            .clone()
            .addScaledVector(normal, end ? b.tipRadius : b.radius);
          positions.push(point.x, point.y, point.z);
          normals.push(normal.x, normal.y, normal.z);
          colors.push(b.color.r, b.color.g, b.color.b);
          if (!end && k < 12) {
            const n = start + k;
            indices.push(n, n + 1, n + 13, n + 1, n + 14, n + 13);
          }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const wood = new THREE.Mesh(geometry, material);
    wood.name = "generated-trunks";
    wood.receiveShadow = true;
    group.add(wood);
  }
  for (const species of TREE_SPECIES) {
    const instances = leaves[species];
    if (!instances.length) continue;
    const geometry = leafGeometry(species);
    geometry.setAttribute(
      "fieldWind",
      new THREE.InstancedBufferAttribute(
        new Float32Array(instances.flatMap((l) => [l.wind.x, l.wind.y])),
        2,
      ),
    );
    const material = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.environmentTime = clock;
      shader.vertexShader =
        "uniform float environmentTime; attribute vec2 fieldWind;\n" + GUST_GLSL +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase=environmentTime*1.4+instanceMatrix[3].x*.7+instanceMatrix[3].z;
        transformed.y+=sin(phase)*(.035+length(fieldWind)*(.02+.24*corridorGust(environmentTime)))*position.z;
      #endif`,
      );
    };
    const foliage = new THREE.InstancedMesh(
      geometry,
      material,
      instances.length,
    );
    instances.forEach((l, i) => {
      matrix.compose(l.p, l.q, l.scale);
      foliage.setMatrixAt(i, matrix);
      foliage.setColorAt(i, l.color);
    });
    foliage.name = `generated-leaves-${species}`;
    foliage.receiveShadow = true;
    foliage.computeBoundingSphere();
    group.add(foliage);
  }
  if (env.trees.length) {
    const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,8),
      new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false}),env.trees.length);
    crowns.name="tree-shadow-crowns";
    crowns.castShadow=true;
    const q=new THREE.Quaternion();
    env.trees.forEach((tree,i)=>{
      const profile=profiles[i], k=profile.scale;
      matrix.compose(new THREE.Vector3(tree.x*2-world.size+1,tree.height+profile.height*k*.7,tree.z*2-world.size+1),q,
        new THREE.Vector3(profile.width*k,profile.height*k*.3,profile.width*k));
      crowns.setMatrixAt(i,matrix);
    });
    crowns.computeBoundingSphere();group.add(crowns);
  }
  return group;
}
