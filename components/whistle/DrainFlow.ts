import * as THREE from "three";
import type { World } from "../../lib/world.ts";
import type { Environment } from "../../lib/environment.ts";
import { drainSources } from "../../lib/environment-effects.ts";

export function makeDrainFlow(world: World, env: Environment, clock: {value:number}) {
  const drains=drainSources(world,env);
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  for (const d of drains) {
    const offset=positions.length/3;
    for(let step=0;step<=16;step++) {
      const t=step/16, fall=Math.max(0,(t-.25)/.75);
      const forward=-.32+t*.95;
      const width=.2*(1-fall*.6);
      for(const side of [-1,1]) {
        positions.push(d.x*2-world.size+1+d.dx*forward+d.dz*side*width,
          d.level+.012-fall*fall*2.8,
          d.z*2-world.size+1+d.dz*forward-d.dx*side*width);
        uvs.push((side+1)/2,t);
      }
      if(step<16) {const a=offset+step*2; indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,
    uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),flowTime:clock},
    vertexShader:`varying vec2 flowUV;
      #include <common>
      #include <fog_pars_vertex>
      void main(){flowUV=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader:`uniform float flowTime;varying vec2 flowUV;
      #include <common>
      #include <fog_pars_fragment>
      void main(){float streak=.55+.45*sin(flowUV.y*48.0-flowTime*9.0+flowUV.x*5.0);
        float edge=smoothstep(0.0,.2,flowUV.x)*smoothstep(0.0,.2,1.0-flowUV.x);
        float fade=smoothstep(0.0,.12,flowUV.y)*(1.0-smoothstep(.65,1.0,flowUV.y));
        float daylight=max(.12,dot(fogColor,vec3(.333)));
        gl_FragColor=vec4((vec3(.035,.12,.14)+streak*.08)*daylight,edge*fade*(.55+streak*.25));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`});
  const mesh=new THREE.Mesh(geometry,material);mesh.name="water-drain-flows";mesh.userData.count=drains.length;
  return mesh;
}
