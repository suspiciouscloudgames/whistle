import { waterLevelAt } from "../../lib/water.ts";
import { addNeutralGrain } from "./NeutralGrain.ts";
import * as THREE from "three";
import { GUST_GLSL } from "../../lib/environment-effects.ts";
import {
  deriveEnvironment,
  environmentAt,
  type Environment,
} from "../../lib/environment.ts";
import type { World } from "../../lib/world.ts";
import { grassAppearance } from "../../lib/vegetation.ts";
import {
  randomSequence,
  terrainSample,
  type Structure,
} from "../../lib/terrain.ts";

export function grassCoverAt(
  world: World,
  x: number,
  z: number,
  structures: Structure[],
  environment: Environment = deriveEnvironment(world, structures),
) {
  if (x < -.5 || z < -.5 || x > environment.size-.5 || z > environment.size-.5) return 0;
  const fx = Math.floor(x), fz = Math.floor(z);
  const tx = (x-fx)**2 * (3-2*(x-fx)), tz = (z-fz)**2 * (3-2*(z-fz));
  const cell = (dx:number,dz:number) => environment.cells[Math.max(0,Math.min(environment.size-1,fz+dz))*environment.size+Math.max(0,Math.min(environment.size-1,fx+dx))].grass;
  const grass = cell(0,0)*((1-tx)*(1-tz)) + cell(1,0)*(tx*(1-tz)) + cell(0,1)*((1-tx)*tz) + cell(1,1)*(tx*tz);
  if (grass <= .035) return 0;
  const sample = terrainSample(world, x, z);
  if (
    sample.coverage < 0.6 ||
    structures.some(
      (s) =>
        s.kind === "stairs" &&
        Math.abs(x - (s.x + s.dx * 0.5)) < 0.56 &&
        Math.abs(z - (s.z + s.dz * 0.5)) < 0.56,
    )
  )
    return 0;
  const water = environment.ponds.length ? waterLevelAt(environment.size,x,z,i=>environment.cells[i].water,i=>environment.cells[i].hole,sample.naturalHeight) : null;
  if (water !== null && water > sample.height) return 0;
  const amount = Math.max(0, Math.min(1, (grass - 0.035) / 0.24));
  return amount * amount * (3 - 2 * amount);
}

export function makeGrass(
  world: World,
  structures: Structure[],
  ground: THREE.BufferGeometry,
  wind: { value: number },
  environment: Environment = deriveEnvironment(world, structures),
  compactOverview = false,
) {
  const group = new THREE.Group();
  group.name = "grassland";
  const area = environment.cells.filter((c) => c.grass > 0).length;
  if (!area) return group;
  const random = randomSequence((world.terrain?.seed ?? 0) ^ 0x67a71);
  const toScene = (n: number) => n * 2 - world.size + 1;

  const patchColor = new THREE.Color();
  const cover = ground.clone();
  const positions = cover.getAttribute("position");
  const coverage: number[] = [], coverColors: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = (positions.getX(i) + world.size - 1) / 2;
    const z = (positions.getZ(i) + world.size - 1) / 2;
    coverage.push(grassCoverAt(world, x, z, structures, environment));
    const tone = grassAppearance(world.terrain?.seed ?? 0, x, z);
    patchColor.setRGB(tone.r, tone.g, tone.b, THREE.SRGBColorSpace);
    const shade = (patchColor.r * .2126 + patchColor.g * .7152 + patchColor.b * .0722) * .5;
    coverColors.push(shade, shade, shade);
    positions.setY(i, positions.getY(i) + .025);
  }
  if (compactOverview) {
    const groundIndices = ground.index!;
    const covered: number[] = [];
    for (let i = 0; i < groundIndices.count; i += 3) {
      const a = groundIndices.getX(i), b = groundIndices.getX(i + 1), c = groundIndices.getX(i + 2);
      if (coverage[a] > 0 || coverage[b] > 0 || coverage[c] > 0) covered.push(a, b, c);
    }
    cover.setIndex(covered);
  }
  cover.setAttribute("grassCover", new THREE.Float32BufferAttribute(coverage, 1));
  cover.setAttribute("color", new THREE.Float32BufferAttribute(coverColors, 3));
  const coverMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    transparent: false,
    depthWrite: true,
  });
  coverMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute float grassCover; varying float vGrassCover; varying vec3 vGrassPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vGrassCover = grassCover;
      vGrassPosition = position;
    `);
    shader.fragmentShader = `
      varying float vGrassCover; varying vec3 vGrassPosition;
      float grassEdgeHash(vec2 p) {
        return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
      }
      float grassEdgeNoise(vec2 p) {
        vec2 cell=floor(p), f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(grassEdgeHash(cell),grassEdgeHash(cell+vec2(1,0)),f.x),
          mix(grassEdgeHash(cell+vec2(0,1)),grassEdgeHash(cell+vec2(1,1)),f.x),f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec2 grainUv=vGrassPosition.xz*vec2(13.0,21.0);
      float grainFade=1.0-smoothstep(.6,1.8,max(length(dFdx(grainUv)),length(dFdy(grainUv))));
      float leafGrain=grassEdgeNoise(grainUv)*2.0-1.0;
      diffuseColor.rgb *= .9 + .08 * leafGrain * grainFade;
      float fringe=smoothstep(.12,.86,vGrassCover);
      float clump=grassEdgeNoise(vGrassPosition.xz*7.0)*.65
        +grassEdgeNoise(vGrassPosition.xz*19.0)*.2;
      float edgeDot=grassEdgeHash(floor(vGrassPosition.xz*64.0));
      if (fringe <= .1+clump+edgeDot*.05) discard;
      diffuseColor.a = 1.0;
    `);
  };
  const understory = new THREE.Mesh(cover, coverMaterial);
  understory.name = "grass-understory";
  understory.receiveShadow = true;
  group.add(understory);

  const bladeGeometry = makeGrassGeometry(random, compactOverview ? 3 : 7);
  const roots: { x: number; z: number; height: number }[] = [],
    budget = 4200,
    spacing = Math.max(0.095, Math.sqrt(area / 3900));
  let accepted = 0;
  for (let z = -0.5 + spacing / 2; z < world.size - 0.5; z += spacing)
    for (let x = -0.5 + spacing / 2; x < world.size - 0.5; x += spacing) {
      const gx = x + (random() - 0.5) * spacing * 0.65,
        gz = z + (random() - 0.5) * spacing * 0.65;
      const chance = random(), cover = grassCoverAt(world,gx,gz,structures,environment);
      if (!cover && chance > 0) continue;
      const growth = environmentAt(environment,gx,gz).growth;
      if (chance > cover * (.82 + growth * .18))
        continue;
      const root = {
        x: toScene(gx),
        z: toScene(gz),
        height: terrainSample(world, gx, gz).height,
      };
      accepted++;
      if (roots.length < budget) roots.push(root);
      else {
        const index = Math.floor(random() * accepted);
        if (index < budget) roots[index] = root;
      }
    }
  if (!roots.length) {
    bladeGeometry.dispose();
    return group;
  }
  bladeGeometry.setAttribute(
    "fieldWind",
    new THREE.InstancedBufferAttribute(
      new Float32Array(
        roots.flatMap((root) => {
          const c = environmentAt(
            environment,
            (root.x + world.size - 1) / 2,
            (root.z + world.size - 1) / 2,
          );
          return [c.windX, c.windZ];
        }),
      ),
      2,
    ),
  );
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 1,
    emissive: "#232323",
    emissiveIntensity: 0.1,
  });
  const strength = { value: 1 };
  group.userData.grassMotion = strength;
  group.userData.grassTime = wind;
  addGrassWind(material, wind, strength);
  addNeutralGrain(material, "grass", world.terrain?.seed ?? 0);
  const grass = new THREE.InstancedMesh(bladeGeometry, material, roots.length);
  grass.name = "grass-tufts";
  const matrix = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  roots.forEach((root, i) => {
    const tone = grassAppearance(
      world.terrain?.seed ?? 0,
      (root.x + world.size - 1) / 2,
      (root.z + world.size - 1) / 2,
    );
    const width = .65 + random() * .9;
    const depth = .65 + random() * .9;
    const stature = .65 + random() * .8;
    const edgeGrowth=.4+.6*grassCoverAt(world,(root.x+world.size-1)/2,(root.z+world.size-1)/2,structures,environment);
    const growth = environmentAt(environment,(root.x + world.size - 1)/2,(root.z + world.size - 1)/2).growth;
    q.setFromEuler(new THREE.Euler((random()-.5)*.26, random()*Math.PI*2, (random()-.5)*.26));
    matrix.compose(
      p.set(root.x, root.height - 0.015, root.z),
      q,
      scale.set(width, tone.height * stature * edgeGrowth * (.85 + growth * .25) * (environmentAt(environment, (root.x + world.size - 1) / 2, (root.z + world.size - 1) / 2).clusterSize < 3 ? .65 : 1), depth),
    );
    grass.setMatrixAt(i, matrix);
    patchColor.setRGB(tone.r, tone.g, tone.b, THREE.SRGBColorSpace);
    patchColor.setScalar(patchColor.r * .2126 + patchColor.g * .7152 + patchColor.b * .0722);
    grass.setColorAt(i, patchColor);
  });
  grass.receiveShadow = true;
  grass.computeBoundingSphere();
  group.add(grass);
  return group;
}

export function makeGrassGeometry(random: () => number, segments = 7) {
  const verts: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    normals: number[] = [],
    bends: number[] = [],
    indices: number[] = [];
  const dark = new THREE.Color().setScalar(0.358),
    light = new THREE.Color().setScalar(0.993),
    color = new THREE.Color();
  for (let leaf = 0; leaf < 12; leaf++) {
    const short = leaf < 4,
      angle = leaf * 2.39996 + random() * 0.4,
      dx = Math.cos(angle),
      dz = Math.sin(angle);
    const h = short ? 0.12 + random() * 0.13 : 0.5 + random() * 0.45;
    const width = short ? 0.026 : 0.009 + random() * 0.008,
      lean = short ? 0.14 : 0.1 + random() * 0.18;
    const rootX = dx * random() * 0.065,
      rootZ = dz * random() * 0.065,
      offset = bends.length;
    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      for (const side of [-1, 1]) {
        const taper =
          Math.sin((t * 0.9 + 0.1) * Math.PI) * (0.7 + 0.3 * (1 - t));
        verts.push(
          rootX + dx * lean * t * t - dz * width * taper * side,
          h * t,
          rootZ + dz * lean * t * t + dx * width * taper * side,
        );
        normals.push(-dz * 0.25, Math.sqrt(1 - 0.25 * 0.25), dx * 0.25);
        bends.push(t * t * (short ? 0.2 : 1));
        uvs.push((side + 1) / 2, t);
        color.copy(dark).lerp(light, t * 0.8);
        colors.push(color.r, color.g, color.b);
      }
      if (segment < segments) {
        const a = offset + segment * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const lowOffset = bends.length;
  const c = Math.cos(.8), s = Math.sin(.8);
  for (let i = 0; i < 4 * (segments + 1) * 2; i++) {
    const x = verts[i * 3], z = verts[i * 3 + 2];
    verts.push((c * x - s * z) * 1.25, verts[i * 3 + 1] * .7, (s * x + c * z) * 1.25);
    normals.push(c * normals[i * 3] - s * normals[i * 3 + 2], normals[i * 3 + 1], s * normals[i * 3] + c * normals[i * 3 + 2]);
    bends.push(bends[i] * .7);
    uvs.push(uvs[i * 2], uvs[i * 2 + 1]);
    colors.push(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
  }
  for (let i = 0; i < 4 * segments * 6; i++) indices.push(indices[i] + lowOffset);
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(verts, 3),
  );
  bladeGeometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(normals, 3),
  );
  bladeGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  bladeGeometry.setAttribute(
    "bend",
    new THREE.Float32BufferAttribute(bends, 1),
  );
  bladeGeometry.setIndex(indices);
  bladeGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return bladeGeometry;
}

export function addGrassWind(material: THREE.Material, wind: { value: number }, strength: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wind = wind;
    shader.uniforms.grassMotion = strength;
    shader.vertexShader =
      "uniform float wind; uniform float grassMotion; attribute float bend; attribute vec2 fieldWind;\n" + GUST_GLSL +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 rootPosition = instanceMatrix[3].xyz;
        float phase = wind * 1.2 + rootPosition.x * .8 + rootPosition.z * .6;
        float gust = .12 + sin(phase)*.1 + sin(wind*2.1+rootPosition.z)*.025;
        vec2 ambientBreeze = vec2(.26, .14);
        vec2 air = ambientBreeze*gust + fieldWind*(.025+.35*corridorGust(wind));
        vec3 breeze = vec3(air.x, 0.0, air.y);
        transformed.x += grassMotion * bend * dot(breeze,instanceMatrix[0].xyz) / dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz);
        transformed.z += grassMotion * bend * dot(breeze,instanceMatrix[2].xyz) / dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz);
      #endif
    `,
    );
  };
}
