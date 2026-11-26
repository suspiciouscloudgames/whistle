import { loadContentTexture } from "./ContentTexture.ts";
import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import type { Asset, Placed, World } from "../../lib/world.ts";

export function surfaceImageGeometry(ground: THREE.Mesh, world: World, placed: Placed, aspect = 1) {
  ground.updateMatrixWorld(true);
  const center = new THREE.Vector3(placed.x * 2 - world.size + 1, 0, placed.z * 2 - world.size + 1);
  const radius = 1.5 * placed.scale / Math.SQRT2;
  const bounds = new THREE.Box3(
    new THREE.Vector3(center.x - radius, -40, center.z - radius),
    new THREE.Vector3(center.x + radius, 40, center.z + radius),
  ).applyMatrix4(ground.matrixWorld.clone().invert());
  const source = ground.geometry, position = source.getAttribute("position"), index = source.index;
  const indices: number[] = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    if (Math.max(position.getX(a), position.getX(b), position.getX(c)) < bounds.min.x ||
        Math.min(position.getX(a), position.getX(b), position.getX(c)) > bounds.max.x ||
        Math.max(position.getZ(a), position.getZ(b), position.getZ(c)) < bounds.min.z ||
        Math.min(position.getZ(a), position.getZ(b), position.getZ(c)) > bounds.max.z) continue;
    indices.push(a, b, c);
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute("position", position);
  patch.setAttribute("normal", source.getAttribute("normal"));
  patch.setIndex(indices);
  const target = new THREE.Mesh(patch);
  target.matrixWorld.copy(ground.matrixWorld);
  const ratio=Number.isFinite(aspect) && aspect>0 ? aspect : 1;
  const size=1.5*placed.scale;
  const result = new DecalGeometry(target, center,
    new THREE.Euler(-Math.PI / 2, 0, -placed.rotation * Math.PI / 180),
    new THREE.Vector3(size*Math.min(1,ratio),size/Math.max(1,ratio),80));
  const vertices=result.getAttribute("position"), uv=result.getAttribute("uv");
  const edges=new Map<string,{a:number;b:number;count:number}>();
  const vertexKey=(i:number)=>[vertices.getX(i),vertices.getY(i),vertices.getZ(i)].map(n=>Math.round(n*10000)).join(":");
  for(let i=0;i<vertices.count;i+=3)for(let j=0;j<3;j++){
    const a=i+j,b=i+(j+1)%3,ka=vertexKey(a),kb=vertexKey(b);
    const key=ka<kb?`${ka}/${kb}`:`${kb}/${ka}`,edge=edges.get(key);
    if(edge)edge.count++;else edges.set(key,{a,b,count:1});
  }
  const cuts=[...edges.values()].filter(({a,b,count})=>count===1 && ![
    [uv.getX(a),uv.getX(b)],[uv.getY(a),uv.getY(b)],
  ].some(([x,y])=>(x<.0001&&y<.0001)||(x>.9999&&y>.9999)));
  const boundary=new Float32Array(vertices.count).fill(1);
  for(let i=0;i<vertices.count;i++)for(const {a,b} of cuts){
    const dx=vertices.getX(b)-vertices.getX(a),dy=vertices.getY(b)-vertices.getY(a),dz=vertices.getZ(b)-vertices.getZ(a);
    const px=vertices.getX(i)-vertices.getX(a),py=vertices.getY(i)-vertices.getY(a),pz=vertices.getZ(i)-vertices.getZ(a);
    const t=THREE.MathUtils.clamp((px*dx+py*dy+pz*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12),0,1);
    boundary[i]=Math.min(boundary[i],Math.hypot(px-dx*t,py-dy*t,pz-dz*t)/size);
  }
  result.setAttribute("surfaceBoundary",new THREE.BufferAttribute(boundary,1));
  patch.dispose();
  (target.material as THREE.Material).dispose();
  return result;
}

export function makeSurfaceImage(asset: Asset, placed: Placed, world: World, terrain: THREE.Group, onGrass = false) {
  const group = new THREE.Group();
  group.userData.surface = true;
  if (onGrass) return group;
  const ground = terrain.getObjectByName("continuous-ground") as THREE.Mesh | undefined;
  if (!ground || !asset.image) return group;
  let disposed=false;
  const texture = loadContentTexture(asset, aspect => {
    if(disposed)return;
    const old=picture.geometry;
    picture.geometry=surfaceImageGeometry(ground,world,placed,aspect);
    old.dispose();
  });
  const material = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, alphaTest: .001, roughness: 1,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
  });
  material.addEventListener("dispose",()=>{disposed=true;});
  if (!asset.text) {
    material.customProgramCacheKey=()=>"surface-image-edge-fade";
    material.onBeforeCompile=shader=>{
      shader.vertexShader="attribute float surfaceBoundary; varying float vSurfaceBoundary;\n"+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\n vSurfaceBoundary=surfaceBoundary;");
      shader.fragmentShader="varying float vSurfaceBoundary;\n"+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace("#include <alphatest_fragment>",`
        #ifdef USE_MAP
          vec2 edgeFade=smoothstep(vec2(0.0),vec2(.18),min(vMapUv,1.0-vMapUv));
          diffuseColor.a*=edgeFade.x*edgeFade.y*smoothstep(0.0,.08,vSurfaceBoundary);
        #endif
        #include <alphatest_fragment>
      `);
    };
  }
  const picture = new THREE.Mesh(surfaceImageGeometry(ground, world, placed), material);
  picture.name = "surface-image";
  picture.renderOrder = 1;
  picture.receiveShadow = true;
  group.add(picture);
  return group;
}
