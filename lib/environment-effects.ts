import type { World } from "./world.ts";
import { terrainSample } from "./terrain.ts";
import { environmentAt, type Environment } from "./environment.ts";

export function wetGround(env: Environment, x: number, z: number, height: number) {
  let wet = 0;
  for (let zz = Math.max(0, Math.floor(z) - 1); zz <= Math.min(env.size - 1, Math.ceil(z) + 1); zz++)
    for (let xx = Math.max(0, Math.floor(x) - 1); xx <= Math.min(env.size - 1, Math.ceil(x) + 1); xx++) {
      const water = env.cells[zz * env.size + xx].water;
      if (water === null || height < water - .04 || height > water + .24) continue;
      wet = Math.max(wet, Math.max(0, 1 - Math.hypot(x - xx, z - zz) / 1.25));
    }
  return wet;
}


export function drainSources(world: World, env: Environment) {
  const drains: { x: number; z: number; dx: number; dz: number; level: number; cell: number; hole: number }[] = [];
  for (let i = 0; i < env.cells.length; i++) {
    const level = env.cells[i].water;
    if (level === null) continue;
    const x = i % env.size, z = Math.floor(i / env.size);
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const hx=x+dx, hz=z+dz, hole=hz*env.size+hx;
      if (hx<0 || hz<0 || hx>=env.size || hz>=env.size || !env.cells[hole].hole) continue;
      let low=0, high=1;
      for(let n=0;n<16;n++) {
        const mid=(low+high)/2;
        if(terrainSample(world,x+dx*mid,z+dz*mid).coverage>=.5) low=mid; else high=mid;
      }
      const t=(low+high)/2, sx=x+dx*(t-.035), sz=z+dz*(t-.035);
      if (environmentAt(env,sx,sz).water !== level || terrainSample(world,sx,sz).height > level) continue;
      if (drains.length < 48) drains.push({x:x+dx*t,z:z+dz*t,dx,dz,level,cell:i,hole});
    }
  }
  return drains;
}


export function fogPatches(env: Environment) {
  const remaining=new Set(env.cells.flatMap((c,i)=>c.fog>.05?[i]:[]));
  const patches: {x:number;z:number;radius:number;strength:number}[]=[];
  while(remaining.size && patches.length<32) {
    const first=remaining.values().next().value!;
    const connected=[first]; remaining.delete(first);
    for(let n=0;n<connected.length;n++) {
      const i=connected[n],x=i%env.size,z=Math.floor(i/env.size);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const xx=x+dx,zz=z+dz,j=zz*env.size+xx;
        if(xx>=0&&zz>=0&&xx<env.size&&zz<env.size&&remaining.delete(j)) connected.push(j);
      }
    }
    const pending=new Set(connected);
    while(pending.size && patches.length<32) {
      const i=pending.values().next().value!,cx=i%env.size,cz=Math.floor(i/env.size);
      const nearby=[...pending].filter(j=>Math.hypot(j%env.size-cx,Math.floor(j/env.size)-cz)<2.2);
      nearby.forEach(j=>pending.delete(j));
      const x=nearby.reduce((s,j)=>s+j%env.size,0)/nearby.length;
      const z=nearby.reduce((s,j)=>s+Math.floor(j/env.size),0)/nearby.length;
      patches.push({x,z,radius:Math.max(...nearby.map(j=>Math.hypot(j%env.size-x,Math.floor(j/env.size)-z)))+.8,
        strength:nearby.reduce((s,j)=>s+env.cells[j].fog,0)/nearby.length});
    }
  }
  return patches;
}


export const GUST_GLSL = `float corridorGust(float time) {
  return pow(max(0.0,sin(time*.63)),6.0);
}
`;
